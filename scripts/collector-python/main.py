import argparse
import os
import time

from browser import create_browser
from collectors.base import CollectorRuntime
from collectors.vivareal import VivaRealCollector

from database import (
    ensure_properties_table,
    upsert_properties,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--transaction", choices=["SALE", "RENT"], default="SALE")
    parser.add_argument("--neighborhood")
    parser.add_argument("--property-type")
    parser.add_argument("--min-price", type=float)
    parser.add_argument("--max-price", type=float)
    parser.add_argument("--min-area", type=float)
    parser.add_argument("--max-area", type=float)
    parser.add_argument("--bedrooms", type=int)
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
    collector = VivaRealCollector()
    url = collector.build_search_url(search_params)

    print("Preparando banco...")

    ensure_properties_table()

    print("Banco preparado.")

    driver = create_browser()

    try:
        print("Abrindo Viva Real...")

        runtime = CollectorRuntime(
            deadline=time.monotonic()
            + float(os.getenv("COLLECTOR_JOB_TIMEOUT_SECONDS", "180")),
            element_timeout_seconds=float(
                os.getenv("COLLECTOR_ELEMENT_TIMEOUT_SECONDS", "15")
            ),
            heartbeat_callback=lambda: None,
        )
        properties = collector.collect(driver, search_params, runtime)

        print("Página:", driver.title)

        print()
        print("Imóveis encontrados:", len(properties))

        if not properties:
            print("Nenhum imóvel encontrado.")
            return

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

        print("Imóveis gravados/atualizados:", saved)

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
