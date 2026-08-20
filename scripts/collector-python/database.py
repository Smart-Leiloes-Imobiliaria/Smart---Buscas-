"""PostgreSQL access shared by the property-search worker and service."""

import json
import os

import psycopg
from psycopg.rows import dict_row


def get_connection():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL não definida no ambiente.")
    return psycopg.connect(database_url, row_factory=dict_row)


def ensure_properties_table():
    """Ensure migrations ran; schema ownership remains with Next.js migrations."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.properties') AS properties, "
                    "to_regclass('public.property_searches') AS searches")
        tables = cur.fetchone()
    if not tables["properties"] or not tables["searches"]:
        raise RuntimeError(
            "Schema do coletor ausente. Execute `npm run db:migrate` antes de iniciar o worker."
        )


PROPERTY_COLUMNS = (
    "source", "source_id", "title", "advertiser_name", "description",
    "sale_price", "rental_price", "city", "state", "neighborhood", "street",
    "bedrooms", "bathrooms", "suites", "parking_spaces", "usable_area",
    "total_area", "condominium_fee", "iptu", "property_type", "image_url",
    "image_urls", "url", "country", "date_posted",
)


def _property_params(property_data):
    data = {column: property_data.get(column) for column in PROPERTY_COLUMNS}
    if not data["source"] or not data["source_id"] or not data["url"]:
        raise ValueError("Imóvel sem source, source_id ou url.")
    data["image_urls"] = json.dumps(data["image_urls"] or [])
    return data


UPSERT_PROPERTIES_SQL = """
INSERT INTO properties (
 source, source_id, title, advertiser_name, description, sale_price, rental_price,
 city, state, neighborhood, street, bedrooms, bathrooms, suites, parking_spaces,
 usable_area, total_area, condominium_fee, iptu, property_type, image_url,
 image_urls, url, country, date_posted, status, last_seen_at, updated_at
) VALUES (
 %(source)s, %(source_id)s, %(title)s, %(advertiser_name)s, %(description)s,
 %(sale_price)s, %(rental_price)s, %(city)s, %(state)s, %(neighborhood)s,
 %(street)s, %(bedrooms)s, %(bathrooms)s, %(suites)s, %(parking_spaces)s,
 %(usable_area)s, %(total_area)s, %(condominium_fee)s, %(iptu)s,
 %(property_type)s, %(image_url)s, %(image_urls)s::jsonb, %(url)s,
 %(country)s, %(date_posted)s, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT (source, source_id) DO UPDATE SET
 title=EXCLUDED.title, advertiser_name=EXCLUDED.advertiser_name,
 description=EXCLUDED.description, sale_price=EXCLUDED.sale_price,
 rental_price=EXCLUDED.rental_price, city=EXCLUDED.city, state=EXCLUDED.state,
 neighborhood=EXCLUDED.neighborhood, street=EXCLUDED.street,
 bedrooms=EXCLUDED.bedrooms, bathrooms=EXCLUDED.bathrooms, suites=EXCLUDED.suites,
 parking_spaces=EXCLUDED.parking_spaces, usable_area=EXCLUDED.usable_area,
 total_area=EXCLUDED.total_area, condominium_fee=EXCLUDED.condominium_fee,
 iptu=EXCLUDED.iptu, property_type=EXCLUDED.property_type,
 image_url=EXCLUDED.image_url, image_urls=EXCLUDED.image_urls, url=EXCLUDED.url,
 country=EXCLUDED.country, date_posted=EXCLUDED.date_posted, status='ACTIVE',
 last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
"""


def upsert_property(property_data):
    return upsert_properties([property_data])


def upsert_properties(properties):
    if not properties:
        return 0
    with get_connection() as conn, conn.cursor() as cur:
        cur.executemany(UPSERT_PROPERTIES_SQL, [_property_params(item) for item in properties])
    return len(properties)


def claim_property_search(search_id=None, *, max_attempts):
    """Atomically claim one due job, safe with multiple worker processes."""
    sql = """
    WITH candidate AS (
      SELECT id FROM property_searches
      WHERE status='PENDING' AND attempts < %(max_attempts)s
        AND COALESCE(next_attempt_at, created_at) <= CURRENT_TIMESTAMP
        AND (%(search_id)s::uuid IS NULL OR id=%(search_id)s::uuid)
      ORDER BY COALESCE(next_attempt_at, created_at), created_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE property_searches AS search SET
      status='RUNNING', attempts=search.attempts + 1, started_at=CURRENT_TIMESTAMP,
      last_heartbeat_at=CURRENT_TIMESTAMP, next_attempt_at=NULL,
      updated_at=CURRENT_TIMESTAMP, error_message=NULL
    FROM candidate WHERE search.id=candidate.id RETURNING search.*
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, {"search_id": search_id, "max_attempts": max_attempts})
        return cur.fetchone()


def heartbeat_property_search(search_id):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE property_searches SET last_heartbeat_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP WHERE id=%s AND status='RUNNING'""", (search_id,))


def link_property_search_results(search_id, properties):
    if not properties:
        return []
    sql = """
    INSERT INTO property_search_results(search_id, property_id)
    SELECT %(search_id)s::uuid, properties.id
    FROM unnest(%(sources)s::text[], %(source_ids)s::text[]) AS item(source, source_id)
    JOIN properties ON properties.source=item.source AND properties.source_id=item.source_id
    ON CONFLICT (search_id, property_id) DO NOTHING RETURNING property_id
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, {
            "search_id": search_id,
            "sources": [item["source"] for item in properties],
            "source_ids": [str(item["source_id"]) for item in properties],
        })
        return [row["property_id"] for row in cur.fetchall()]


def complete_property_search(search_id, properties_found):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE property_searches SET status='COMPLETED', properties_found=%s,
          completed_at=CURRENT_TIMESTAMP, last_heartbeat_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP WHERE id=%s AND status='RUNNING'""",
                    (properties_found, search_id))


def retry_property_search(search_id, error, delay_seconds):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE property_searches SET status='PENDING', error_message=%s,
          next_attempt_at=CURRENT_TIMESTAMP + make_interval(secs => %s),
          updated_at=CURRENT_TIMESTAMP WHERE id=%s AND status='RUNNING'""",
                    (str(error)[:2000], float(delay_seconds), search_id))


def fail_property_search(search_id, error):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE property_searches SET status='FAILED', error_message=%s,
          completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=%s AND status IN ('PENDING', 'RUNNING')""",
                    (str(error)[:2000], search_id))


def recover_stale_property_searches(*, stale_after_seconds, max_attempts, retry_delay_seconds):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""WITH stale AS (
          SELECT id, attempts FROM property_searches WHERE status='RUNNING'
          AND COALESCE(last_heartbeat_at, started_at, updated_at) <
            CURRENT_TIMESTAMP - make_interval(secs => %s) FOR UPDATE SKIP LOCKED
        ), updated AS (
          UPDATE property_searches search SET
            status=CASE WHEN stale.attempts < %s THEN 'PENDING' ELSE 'FAILED' END,
            next_attempt_at=CASE WHEN stale.attempts < %s THEN
              CURRENT_TIMESTAMP + make_interval(secs => %s) ELSE NULL END,
            completed_at=CASE WHEN stale.attempts < %s THEN NULL ELSE CURRENT_TIMESTAMP END,
            error_message='Worker interrompido: pesquisa recuperada automaticamente.',
            updated_at=CURRENT_TIMESTAMP FROM stale WHERE search.id=stale.id
          RETURNING search.status
        ) SELECT status, COUNT(*) AS count FROM updated GROUP BY status""",
                    (float(stale_after_seconds), max_attempts, max_attempts,
                     float(retry_delay_seconds), max_attempts))
        rows = cur.fetchall()
    counts = {row["status"]: row["count"] for row in rows}
    return {"retried": counts.get("PENDING", 0), "failed": counts.get("FAILED", 0)}


def get_disabled_source_codes():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT upper(code) AS code FROM source WHERE enabled=FALSE")
        return {row["code"] for row in cur.fetchall()}


def get_property_search(search_id):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM property_searches WHERE id=%s", (search_id,))
        return cur.fetchone()
