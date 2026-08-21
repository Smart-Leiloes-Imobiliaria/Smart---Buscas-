import hashlib
import json
import os
import re
import unicodedata
import uuid

from psycopg.types.json import Jsonb

from database import get_connection


CACHE_TTL_MINUTES = int(
    os.getenv("SCRAPE_CACHE_TTL_MINUTES", "120")
)

RUNNING_LOCK_MINUTES = int(
    os.getenv("SCRAPE_RUNNING_LOCK_MINUTES", "30")
)

FAILURE_COOLDOWN_MINUTES = int(
    os.getenv("SCRAPE_FAILURE_COOLDOWN_MINUTES", "10")
)


def _normalize_text(value: str):
    value = value.strip().casefold()

    value = unicodedata.normalize("NFKD", value)

    value = "".join(
        char
        for char in value
        if not unicodedata.combining(char)
    )

    value = re.sub(r"\s+", " ", value)

    return value


def _normalize_value(value):
    if value is None:
        return None

    if isinstance(value, str):
        value = _normalize_text(value)

        if not value:
            return None

        return value

    if isinstance(value, dict):
        return {
            key: _normalize_value(value[key])
            for key in sorted(value)
            if _normalize_value(value[key]) is not None
        }

    if isinstance(value, (list, tuple, set)):
        normalized = [
            _normalize_value(item)
            for item in value
        ]

        normalized = [
            item
            for item in normalized
            if item is not None
        ]

        return sorted(
            normalized,
            key=lambda item: json.dumps(
                item,
                sort_keys=True,
                ensure_ascii=False,
            ),
        )

    return value


def normalize_search_params(params: dict):
    return _normalize_value(params)


def make_search_key(params: dict):
    normalized = normalize_search_params(params)

    payload = json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )

    search_key = hashlib.sha256(
        payload.encode("utf-8")
    ).hexdigest()

    return search_key, normalized


def ensure_searches_table():
    sql = """
    CREATE TABLE IF NOT EXISTS searches (
        search_key TEXT PRIMARY KEY,

        params JSONB NOT NULL,
        normalized_params JSONB NOT NULL,

        status TEXT NOT NULL DEFAULT 'IDLE',

        request_count BIGINT NOT NULL DEFAULT 0,
        attempt_count BIGINT NOT NULL DEFAULT 0,

        result_count INTEGER,

        last_requested_at TIMESTAMPTZ,
        last_collected_at TIMESTAMPTZ,

        collection_started_at TIMESTAMPTZ,
        collection_finished_at TIMESTAMPTZ,

        lock_expires_at TIMESTAMPTZ,

        claim_token TEXT,

        last_error TEXT,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_searches_last_collected
    ON searches (last_collected_at DESC);

    CREATE INDEX IF NOT EXISTS idx_searches_status
    ON searches (status);
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)

        conn.commit()


def try_claim_search(
    params: dict,
    cache_ttl_minutes: int = CACHE_TTL_MINUTES,
    lock_minutes: int = RUNNING_LOCK_MINUTES,
    failure_cooldown_minutes: int = FAILURE_COOLDOWN_MINUTES,
):
    """
    Tenta obter permissão exclusiva para executar a coleta.

    Retorna:
        {
            "should_collect": True/False,
            "reason": "...",
            "search_key": "...",
            "claim_token": "..."
        }
    """

    search_key, normalized = make_search_key(params)

    claim_token = str(uuid.uuid4())

    with get_connection() as conn:
        with conn.cursor() as cur:

            # Garante que a busca exista.
            cur.execute(
                """
                INSERT INTO searches (
                    search_key,
                    params,
                    normalized_params
                )
                VALUES (
                    %s,
                    %s,
                    %s
                )
                ON CONFLICT (search_key)
                DO NOTHING;
                """,
                (
                    search_key,
                    Jsonb(params),
                    Jsonb(normalized),
                ),
            )

            # Registra que alguém solicitou essa pesquisa.
            #
            # Esse UPDATE também força serialização das
            # requisições concorrentes para a mesma busca.
            cur.execute(
                """
                UPDATE searches
                SET
                    params = %s,
                    normalized_params = %s,
                    request_count = request_count + 1,
                    last_requested_at = NOW(),
                    updated_at = NOW()
                WHERE search_key = %s;
                """,
                (
                    Jsonb(params),
                    Jsonb(normalized),
                    search_key,
                ),
            )

            # Tenta reservar a coleta.
            cur.execute(
                """
                UPDATE searches
                SET
                    status = 'RUNNING',

                    attempt_count = attempt_count + 1,

                    collection_started_at = NOW(),
                    collection_finished_at = NULL,

                    lock_expires_at =
                        NOW()
                        + (%s * INTERVAL '1 minute'),

                    claim_token = %s,

                    last_error = NULL,

                    updated_at = NOW()

                WHERE search_key = %s

                -- Existem dados recentes.
                AND NOT (
                    last_collected_at IS NOT NULL
                    AND last_collected_at >
                        NOW()
                        - (%s * INTERVAL '1 minute')
                )

                -- Outra coleta está em andamento.
                AND NOT (
                    status = 'RUNNING'
                    AND lock_expires_at IS NOT NULL
                    AND lock_expires_at > NOW()
                )

                -- Evita martelar o site depois de erro.
                AND NOT (
                    status = 'FAILED'
                    AND collection_finished_at IS NOT NULL
                    AND collection_finished_at >
                        NOW()
                        - (%s * INTERVAL '1 minute')
                )

                RETURNING
                    search_key,
                    status,
                    claim_token,
                    last_collected_at,
                    collection_started_at;
                """,
                (
                    lock_minutes,
                    claim_token,
                    search_key,
                    cache_ttl_minutes,
                    failure_cooldown_minutes,
                ),
            )

            claimed = cur.fetchone()

            if claimed:
                conn.commit()

                return {
                    "should_collect": True,
                    "reason": "CLAIMED",
                    "search_key": search_key,
                    "claim_token": claim_token,
                }

            # Não conseguiu reservar.
            # Descobre o motivo.
            cur.execute(
                """
                SELECT
                    status,
                    last_collected_at,
                    collection_started_at,
                    collection_finished_at,
                    lock_expires_at,

                    (
                        last_collected_at IS NOT NULL
                        AND last_collected_at >
                            NOW()
                            - (%s * INTERVAL '1 minute')
                    ) AS cache_fresh,

                    (
                        status = 'RUNNING'
                        AND lock_expires_at IS NOT NULL
                        AND lock_expires_at > NOW()
                    ) AS already_running,

                    (
                        status = 'FAILED'
                        AND collection_finished_at IS NOT NULL
                        AND collection_finished_at >
                            NOW()
                            - (%s * INTERVAL '1 minute')
                    ) AS failure_cooldown

                FROM searches
                WHERE search_key = %s;
                """,
                (
                    cache_ttl_minutes,
                    failure_cooldown_minutes,
                    search_key,
                ),
            )

            state = cur.fetchone()

        conn.commit()

    reason = "NOT_CLAIMED"

    if state:
        if state["cache_fresh"]:
            reason = "CACHE_FRESH"

        elif state["already_running"]:
            reason = "ALREADY_RUNNING"

        elif state["failure_cooldown"]:
            reason = "FAILURE_COOLDOWN"

    return {
        "should_collect": False,
        "reason": reason,
        "search_key": search_key,
        "claim_token": None,
        "state": state,
    }


def mark_search_success(
    search_key: str,
    claim_token: str,
    result_count: int = 0,
):
    """
    Marca a coleta como concluída com sucesso.
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE searches
                SET
                    status = 'SUCCESS',

                    result_count = %s,

                    last_collected_at = NOW(),

                    collection_finished_at = NOW(),

                    lock_expires_at = NULL,
                    claim_token = NULL,

                    last_error = NULL,

                    updated_at = NOW()

                WHERE search_key = %s
                  AND claim_token = %s
                  AND status = 'RUNNING';
                """,
                (
                    result_count,
                    search_key,
                    claim_token,
                ),
            )

        conn.commit()


def mark_search_failed(
    search_key: str,
    claim_token: str,
    error,
):
    """
    Marca a tentativa atual como falha.
    """

    error_message = str(error)

    # Não precisa guardar traceback infinito no banco.
    error_message = error_message[:5000]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE searches
                SET
                    status = 'FAILED',

                    collection_finished_at = NOW(),

                    lock_expires_at = NULL,
                    claim_token = NULL,

                    last_error = %s,

                    updated_at = NOW()

                WHERE search_key = %s
                  AND claim_token = %s
                  AND status = 'RUNNING';
                """,
                (
                    error_message,
                    search_key,
                    claim_token,
                ),
            )

        conn.commit()