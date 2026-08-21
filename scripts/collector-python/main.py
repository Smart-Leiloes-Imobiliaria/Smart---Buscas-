import argparse
import os
import time

from search_guard import (
     ensure_searches_table,
       try_claim_search,
       mark_search_success,
       mark_search_failed,
)

from browser import create_browser
from collectors.base import CollectorRuntime
from collectors.vivareal import VivaRealCollector

from database import (
    ensure_properties_table,
    upsert_properties,
)

def run_collection(search_params):
    print("Preparando banco...")

    ensure_properties_table()
    ensure_searches_table()

    print("Banco preparado.")

    # ------------ PROTEÇÃO CONTRA COLETAS REPETIDAS ---------

    claim = try_claim_search(search_params)

    if not claim["should_collect"]:
        reason = claim["reason"]

        if reason == "CACHE_FRESH":
            print(
                "Coleta ignorada: "
                "essa pesquisa já possui dados recentes."
            )

        elif reason == "ALREADY_RUNNING":
            print(
                "Coleta ignorada: "
                "essa mesma pesquisa já está sendo coletada."
            )

        elif reason == "FAILURE_COOLDOWN":
            print(
                "Coleta ignorada: "
                "houve uma falha recente nessa pesquisa."
            )

        else:
            print(
                "Coleta não iniciada:",
                reason,
            )

        return {
            "ok": True,
            "collected": False,
            "reason": reason,
            "search_key": claim["search_key"],
        }

    search_key = claim["search_key"]
    claim_token = claim["claim_token"]

    print("Coleta autorizada.")
    print("Search key:", search_key)

    # COLETOR

    collector = VivaRealCollector()

    url = collector.build_search_url(search_params)

    print("URL da pesquisa:")
    print(url)

    driver = None

    try:
        driver = create_browser()

        print("Abrindo Viva Real...")

        runtime = CollectorRuntime(
            deadline=(
                time.monotonic()
                + float(
                    os.getenv(
                        "COLLECTOR_JOB_TIMEOUT_SECONDS",
                        "180",
                    )
                )
            ),
            element_timeout_seconds=float(
                os.getenv(
                    "COLLECTOR_ELEMENT_TIMEOUT_SECONDS",
                    "15",
                )
            ),
            heartbeat_callback=lambda: None,
        )

        properties = collector.collect(
            driver,
            search_params,
            runtime,
        )

        print("Página:", driver.title)

        print()
        print(
            "Imóveis encontrados:",
            len(properties),
        )

        # Zero imóveis também é uma coleta válida.
        #
        # e preciso marcar como SUCCESS para que outra
        # pesquisa igual não abra Selenium na hora .
        if not properties:
            print("Nenhum imóvel encontrado.")

            mark_search_success(
                search_key=search_key,
                claim_token=claim_token,
                result_count=0,
            )

            return {
                "ok": True,
                "collected": True,
                "search_key": search_key,
                "found": 0,
                "saved": 0,
            }

        print()
        print("Primeiro imóvel:")

        first = properties[0]

        print("ID:", first["source_id"])
        print("Preço:", first["sale_price"])
        print("Cidade:", first["city"])
        print("Quartos:", first["bedrooms"])
        print("Área:", first["usable_area"])
        print("URL:", first["url"])

        print()
        print("Salvando no PostgreSQL...")

        saved = upsert_properties(properties)

        print(
            "Imóveis gravados/atualizados:",
            saved,
        )

        mark_search_success(
            search_key=search_key,
            claim_token=claim_token,
            result_count=saved,
        )

        print("Coleta concluída com sucesso.")

        return {
            "ok": True,
            "collected": True,
            "search_key": search_key,
            "found": len(properties),
            "saved": saved,
        }

    except Exception as error:
        print()
        print(
            "Erro durante a coleta:",
            error,
        )

        try:
            mark_search_failed(
                search_key=search_key,
                claim_token=claim_token,
                error=error,
            )
        except Exception as guard_error:
            # Não queremos esconder o erro original do scraper
            # caso também ocorra algum problema ao atualizar
            # o controle no banco.
            print(
                "Erro ao registrar falha da coleta:",
                guard_error,
            )

        raise

    finally:
        if driver is not None:
            driver.quit()


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--city",
        required=True,
    )

    parser.add_argument(
        "--state",
        required=True,
    )

    parser.add_argument(
        "--transaction",
        choices=["SALE", "RENT"],
        default="SALE",
    )

    parser.add_argument(
        "--neighborhood",
    )

    parser.add_argument(
        "--property-type",
    )

    parser.add_argument(
        "--min-price",
        type=float,
    )

    parser.add_argument(
        "--max-price",
        type=float,
    )

    parser.add_argument(
        "--min-area",
        type=float,
    )

    parser.add_argument(
        "--max-area",
        type=float,
    )

    parser.add_argument(
        "--bedrooms",
        type=int,
    )

    args = parser.parse_args()

    search_params = {
        "city": args.city,
        "state": args.state,
        "transaction": args.transaction,
        "neighborhood": args.neighborhood,
        "propertyType": args.property_type,
        "minPrice": args.min_price,
        "maxPrice": args.max_price,
        "minArea": args.min_area,
        "maxArea": args.max_area,
        "bedrooms": args.bedrooms,
    }

    result = run_collection(search_params)

    print()
    print("Resultado:")
    print(result)


if __name__ == "__main__":
    main()