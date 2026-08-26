import argparse
import os
import time

from selenium.common.exceptions import WebDriverException

from browser import create_browser
from collectors.base import CollectorRuntime, TemporaryCollectorError
from collectors.deduplication import deduplicate_cross_source
from collectors.registry import get_enabled_collectors
from database import (
    claim_property_search,
    complete_property_search,
    ensure_properties_table,
    fail_property_search,
    get_disabled_source_codes,
    heartbeat_property_search,
    link_property_search_results,
    recover_stale_property_searches,
    retry_property_search,
    upsert_properties,
)


def env_float(name, default, minimum=0.1):
    value = float(os.getenv(name, str(default)))
    if value < minimum:
        raise ValueError(f"{name} deve ser maior ou igual a {minimum}.")
    return value


def env_int(name, default, minimum=1):
    value = int(os.getenv(name, str(default)))
    if value < minimum:
        raise ValueError(f"{name} deve ser maior ou igual a {minimum}.")
    return value


def collector_settings():
    return {
        "max_attempts": env_int("COLLECTOR_MAX_ATTEMPTS", 3),
        "retry_base_seconds": env_float("COLLECTOR_RETRY_BASE_SECONDS", 5),
        "retry_max_seconds": env_float("COLLECTOR_RETRY_MAX_SECONDS", 60),
        "job_timeout_seconds": env_float("COLLECTOR_JOB_TIMEOUT_SECONDS", 180),
        "element_timeout_seconds": env_float(
            "COLLECTOR_ELEMENT_TIMEOUT_SECONDS",
            15,
        ),
        "heartbeat_interval_seconds": env_float(
            "COLLECTOR_HEARTBEAT_INTERVAL_SECONDS",
            15,
        ),
        "stale_after_seconds": env_float(
            "COLLECTOR_STALE_AFTER_SECONDS",
            300,
        ),
    }


def retry_delay_seconds(attempt, settings):
    delay = settings["retry_base_seconds"] * (2 ** max(0, attempt - 1))
    return min(delay, settings["retry_max_seconds"])


def retry_delay_for_error(attempt, settings, error):
    return max(
        retry_delay_seconds(attempt, settings),
        float(getattr(error, "retry_after_seconds", 0)),
    )


def recover_stale_searches(settings):
    recovered = recover_stale_property_searches(
        stale_after_seconds=settings["stale_after_seconds"],
        max_attempts=settings["max_attempts"],
        retry_delay_seconds=settings["retry_base_seconds"],
    )
    if recovered["retried"] or recovered["failed"]:
        print(
            "Pesquisas RUNNING recuperadas:",
            recovered["retried"],
            "reagendadas e",
            recovered["failed"],
            "encerradas.",
        )
    return recovered


def process_property_search(search_id=None):
    settings = collector_settings()
    recover_stale_searches(settings)

    search = claim_property_search(
        search_id,
        max_attempts=settings["max_attempts"],
    )
    if not search:
        return None

    claimed_id = str(search["id"])
    criteria = search["criteria"]
    if not isinstance(criteria, dict):
        criteria = {}

    attempt = int(search["attempts"])
    print(f"Processando pesquisa {claimed_id}, tentativa {attempt}...")
    deadline = time.monotonic() + settings["job_timeout_seconds"]

    try:
        disabled_sources = get_disabled_source_codes()
        collectors = [
            collector
            for collector in get_enabled_collectors()
            if collector.source not in disabled_sources
        ]
        if not collectors:
            raise TemporaryCollectorError(
                "Nenhum portal habilitado para esta pesquisa no momento."
            )
        all_properties = []
        successful_collectors = 0
        collector_errors = []

        for collector in collectors:
            runtime = CollectorRuntime(
                deadline=deadline,
                element_timeout_seconds=settings["element_timeout_seconds"],
                heartbeat_callback=lambda: heartbeat_property_search(claimed_id),
                heartbeat_interval_seconds=settings["heartbeat_interval_seconds"],
            )
            runtime.ensure_active()
            print(f"Coletando {collector.name}:", collector.build_search_url(criteria))
            driver = None

            try:
                if getattr(collector, "uses_browser", True):
                    driver = create_browser()
                properties = collector.collect(driver, criteria, runtime)
                properties = properties[: collector.result_limit]
                print(f"{collector.name}: {len(properties)} imóveis compatíveis.")
                all_properties.extend(properties)
                successful_collectors += 1
            except TemporaryCollectorError as error:
                collector_errors.append(error)
                print(f"{collector.name}: coleta temporariamente indisponível: {error}")
            except WebDriverException as error:
                collector_error = TemporaryCollectorError(
                    f"{collector.name}: o navegador encerrou inesperadamente: {error}"
                )
                collector_errors.append(collector_error)
                print(
                    f"{collector.name}: coleta temporariamente indisponível: "
                    f"{collector_error}"
                )
            finally:
                if driver:
                    try:
                        driver.quit()
                    except WebDriverException:
                        pass

        if successful_collectors == 0 and collector_errors:
            raise max(
                collector_errors,
                key=lambda error: float(
                    getattr(error, "retry_after_seconds", 0)
                ),
            )
        if collector_errors:
            print(
                f"Pesquisa {claimed_id}: concluindo parcialmente; "
                f"{len(collector_errors)} fonte(s) indisponível(is): "
                + " | ".join(str(error) for error in collector_errors)
            )

        heartbeat_property_search(claimed_id)
        upsert_properties(all_properties)
        display_properties, duplicates = deduplicate_cross_source(all_properties)
        if duplicates:
            print(
                f"Pesquisa {claimed_id}: {len(duplicates)} duplicidade(s) entre portais removida(s)."
            )
        property_ids = link_property_search_results(claimed_id, display_properties)
        partial_error = None
        if collector_errors:
            partial_error = (
                "Coleta concluída parcialmente. Fontes com problema: "
                + " | ".join(str(error) for error in collector_errors)
            )[:2000]
        if partial_error:
            complete_property_search(
                claimed_id,
                len(property_ids),
                partial_error,
            )
        else:
            complete_property_search(claimed_id, len(property_ids))
        print(f"Pesquisa {claimed_id} concluída com {len(property_ids)} imóveis.")
        return {
            "search_id": claimed_id,
            "status": "COMPLETED",
            "properties_found": len(property_ids),
            "attempts": attempt,
        }
    except TemporaryCollectorError as error:
        if attempt < settings["max_attempts"]:
            delay = retry_delay_for_error(attempt, settings, error)
            retry_property_search(claimed_id, error, delay)
            print(
                f"Pesquisa {claimed_id} será repetida em {delay:g}s: {error}"
            )
            return {
                "search_id": claimed_id,
                "status": "RETRYING",
                "attempts": attempt,
                "retry_after_seconds": delay,
                "error": str(error),
            }

        fail_property_search(claimed_id, error)
        print(f"Pesquisa {claimed_id} falhou após {attempt} tentativas: {error}")
        return {
            "search_id": claimed_id,
            "status": "FAILED",
            "attempts": attempt,
            "error": str(error),
        }
    except Exception as error:
        fail_property_search(claimed_id, error)
        print(f"Pesquisa {claimed_id} falhou sem retry: {error}")
        return {
            "search_id": claimed_id,
            "status": "FAILED",
            "attempts": attempt,
            "error": str(error),
        }


def run_worker(poll_interval):
    print("Worker de pesquisas iniciado.")
    while True:
        try:
            result = process_property_search()
        except Exception as error:
            print(f"Falha operacional do worker: {error}")
            result = None

        if result is None or result["status"] != "COMPLETED":
            time.sleep(poll_interval)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--search-id")
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=float(os.getenv("COLLECTOR_POLL_INTERVAL", "2")),
    )
    args = parser.parse_args()

    ensure_properties_table()

    if args.once or args.search_id:
        result = process_property_search(args.search_id)
        if result is None:
            print("Nenhuma pesquisa disponível para processamento.")
        return

    run_worker(args.poll_interval)


if __name__ == "__main__":
    main()
