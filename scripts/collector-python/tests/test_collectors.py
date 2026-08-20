import time
import unittest
from unittest.mock import patch

from collectors.base import (
    BlockedCollectorError,
    CollectorRuntime,
    PermanentCollectorError,
    TemporaryCollectorError,
)
from collectors.registry import get_enabled_collectors
from collectors.portals import (
    CasaMineiraCollector,
    ImovelwebCollector,
    OlxCollector,
    QuintoAndarCollector,
    ZapCollector,
)
from collectors.vivareal import (
    VivaRealCollector,
    build_vivareal_search_url,
    extract_property_type,
    extract_transaction,
)


class FakeScript:
    def __init__(self, raw):
        self.raw = raw

    def get_attribute(self, name):
        return self.raw if name == "innerHTML" else None


class FakeDriver:
    title = "Imóveis à venda"
    page_source = "<html></html>"

    def __init__(self, scripts):
        self.scripts = scripts
        self.opened_url = None
        self.current_url = None
        self.opened_urls = []
        self.execute_script_calls = 0

    def get(self, url):
        self.opened_url = url
        self.current_url = url
        self.opened_urls.append(url)

    def find_elements(self, by, selector):
        return self.scripts

    def execute_script(self, script, *args):
        self.execute_script_calls += 1
        return None


class CollectorTests(unittest.TestCase):
    def runtime(self):
        return CollectorRuntime(
            deadline=time.monotonic() + 10,
            element_timeout_seconds=1,
            heartbeat_callback=lambda: None,
        )

    def test_registry_enables_vivareal_by_default(self):
        self.assertEqual(
            [collector.source for collector in get_enabled_collectors()],
            ["VIVAREAL"],
        )

    def test_registry_can_enable_all_portals(self):
        with patch.dict(
            "os.environ",
            {
                "COLLECTOR_SOURCES": (
                    "VIVAREAL,ZAP,IMOVELWEB,CASAMINEIRA,OLX,QUINTOANDAR"
                )
            },
        ):
            self.assertEqual(
                [collector.source for collector in get_enabled_collectors()],
                [
                    "VIVAREAL",
                    "ZAP",
                    "IMOVELWEB",
                    "CASAMINEIRA",
                    "OLX",
                    "QUINTOANDAR",
                ],
            )

    def test_runtime_rejects_expired_job(self):
        runtime = CollectorRuntime(
            deadline=time.monotonic() - 1,
            element_timeout_seconds=1,
            heartbeat_callback=lambda: None,
        )
        with self.assertRaises(TemporaryCollectorError):
            runtime.ensure_active()

    def test_blocked_portal_raises_retryable_error_with_collector_name(self):
        driver = FakeDriver([])
        driver.title = "Just a moment"
        with self.assertRaisesRegex(BlockedCollectorError, "Viva Real"):
            VivaRealCollector().collect(
                driver,
                {"city": "Belo Horizonte", "state": "MG", "transaction": "SALE"},
                self.runtime(),
            )

    def test_vivareal_builds_and_normalizes_a_property(self):
        raw = """
        {
          "@type": "Apartment",
          "url": "https://www.vivareal.com.br/imovel/apartamento-2-quartos-castelo-belo-horizonte-com-garagem-75m2-venda-RS650000-id-123456/",
          "name": "Apartamento no Castelo",
          "description": "2 banheiros, 1 suíte, condomínio R$ 450 e IPTU R$ 180",
          "numberOfBedrooms": 2,
          "floorSize": {"value": 75},
          "offers": {"price": 650000},
          "image": ["https://images.example/1.jpg"],
          "address": {
            "addressLocality": "Belo Horizonte",
            "addressRegion": "MG",
            "addressCountry": "BR"
          }
        }
        """
        driver = FakeDriver([FakeScript(raw)])
        collector = VivaRealCollector()
        criteria = {
            "city": "Belo Horizonte",
            "state": "MG",
            "transaction": "SALE",
            "propertyType": "APARTMENT",
            "minPrice": 500000,
        }

        properties = collector.collect(driver, criteria, self.runtime())

        self.assertEqual(len(properties), 1)
        self.assertEqual(properties[0]["source_id"], "123456")
        self.assertEqual(properties[0]["sale_price"], 650000)
        self.assertEqual(properties[0]["neighborhood"], "Castelo")
        self.assertIn("precoMinimo=500000", driver.opened_url)

    def test_builds_sale_rent_neighborhood_and_property_type_urls(self):
        cases = [
            ({"transaction": "SALE"}, "/venda/"),
            ({"transaction": "RENT"}, "/aluguel/"),
            ({"neighborhood": "Savassi"}, "/bairros/savassi/"),
            ({"propertyType": "APARTMENT"}, "/apartamento_residencial/"),
            ({"propertyType": "HOUSE"}, "/casa_residencial/"),
            ({"propertyType": "PENTHOUSE"}, "/cobertura_residencial/"),
            ({"propertyType": "COMMERCIAL_ROOM"}, "/sala_comercial/"),
            ({"propertyType": "COMMERCIAL"}, "/imovel_comercial/"),
        ]

        for extra, expected in cases:
            with self.subTest(extra=extra):
                url = build_vivareal_search_url({
                    "city": "Belo Horizonte",
                    "state": "MG",
                    **extra,
                })
                self.assertIn(expected, url)

    def test_builds_urls_for_all_registered_portals(self):
        criteria = {
            "city": "Belo Horizonte",
            "state": "MG",
            "transaction": "SALE",
            "propertyType": "APARTMENT",
            "neighborhood": "Savassi",
        }
        cases = [
            (ZapCollector(), "zapimoveis.com.br/venda/apartamentos/mg%2Bbelo-horizonte%2Bsavassi/"),
            (ImovelwebCollector(), "apartamentos-venda-savassi-belo-horizonte-mg.html"),
            (CasaMineiraCollector(), "casamineira.com.br/venda/imovel/belo-horizonte_mg"),
            (OlxCollector(), "olx.com.br/imoveis/venda/apartamentos/estado-mg/belo-horizonte-e-regiao"),
            (QuintoAndarCollector(), "quintoandar.com.br/comprar/imovel/savassi-belo-horizonte-mg-brasil/apartamento"),
        ]

        for collector, expected in cases:
            with self.subTest(source=collector.source):
                self.assertIn(expected, collector.build_search_url(criteria))

    def test_normalizes_nested_quintoandar_jsonld(self):
        raw = """
        {
          "@type": "ItemList",
          "itemListElement": [{
            "@type": "ListItem",
            "item": {
              "@type": "RealEstateListing",
              "url": "https://www.quintoandar.com.br/imovel/894031706/comprar/apartamento-3-quartos-buritis-belo-horizonte",
              "name": "Apartamento com 3 dorms, 235m²",
              "description": "Comprar apartamento em Buritis com 3 quartos.",
              "image": "https://images.example/quinto.jpg",
              "about": {
                "@type": "Apartment",
                "numberOfBedrooms": 3,
                "numberOfFullBathrooms": 2,
                "floorSize": {"value": 235},
                "address": {
                  "streetAddress": "Rua Lauro Ferreira, Buritis",
                  "addressLocality": "Belo Horizonte",
                  "addressRegion": "MG",
                  "addressCountry": "BR"
                }
              },
              "offers": {"price": 1590000}
            }
          }]
        }
        """
        properties = QuintoAndarCollector().collect(
            FakeDriver([FakeScript(raw)]),
            {
                "city": "Belo Horizonte",
                "state": "MG",
                "transaction": "SALE",
                "propertyType": "APARTMENT",
                "neighborhood": "Buritis",
            },
            self.runtime(),
        )

        self.assertEqual(len(properties), 1)
        self.assertEqual(properties[0]["source"], "QUINTOANDAR")
        self.assertEqual(properties[0]["source_id"], "894031706")
        self.assertEqual(properties[0]["street"], "Rua Lauro Ferreira")
        self.assertEqual(properties[0]["neighborhood"], "Buritis")
        self.assertEqual(properties[0]["sale_price"], 1590000)
        self.assertEqual(properties[0]["bathrooms"], 2)

    def test_assigns_collected_price_to_rental(self):
        raw = """
        {
          "@type": "Apartment",
          "url": "https://www.vivareal.com.br/imovel/apartamento-1-quarto-savassi-belo-horizonte-45m2-aluguel-RS2500-id-789/",
          "offers": {"price": 2500},
          "address": {"addressLocality": "Belo Horizonte", "addressRegion": "MG"}
        }
        """
        driver = FakeDriver([FakeScript(raw)])
        properties = VivaRealCollector().collect(
            driver,
            {
                "city": "Belo Horizonte",
                "state": "MG",
                "transaction": "RENT",
                "neighborhood": "Savassi",
            },
            self.runtime(),
        )

        self.assertEqual(properties[0]["rental_price"], 2500)
        self.assertIsNone(properties[0]["sale_price"])
        self.assertEqual(properties[0]["neighborhood"], "Savassi")

    def test_extracts_supported_property_types(self):
        cases = {
            "https://example/imovel/apartamento-1-quarto-id-1/": "APARTMENT",
            "https://example/imovel/casa-2-quartos-id-2/": "HOUSE",
            "https://example/imovel/cobertura-3-quartos-id-3/": "PENTHOUSE",
            "https://example/imovel/sala-comercial-id-4/": "COMMERCIAL_ROOM",
            "https://example/imovel/imovel-comercial-id-5/": "COMMERCIAL",
        }
        for url, expected in cases.items():
            with self.subTest(url=url):
                self.assertEqual(extract_property_type(url), expected)

    def test_extracts_sale_and_rent_from_listing_url(self):
        self.assertEqual(
            extract_transaction("https://example/imovel/apartamento-aluguel-RS2500-id-1/"),
            "RENT",
        )
        self.assertEqual(
            extract_transaction("https://example/imovel/apartamento-venda-RS500000-id-2/"),
            "SALE",
        )

    def test_ignores_rental_listing_on_sale_search(self):
        raw = """
        {
          "@type": "Apartment",
          "url": "https://www.vivareal.com.br/imovel/apartamento-2-quartos-centro-belo-horizonte-70m2-aluguel-RS2500-id-999/",
          "offers": {"price": 2500},
          "address": {"addressLocality": "Belo Horizonte", "addressRegion": "MG"}
        }
        """
        properties = VivaRealCollector().collect(
            FakeDriver([FakeScript(raw)]),
            {"city": "Belo Horizonte", "state": "MG", "transaction": "SALE"},
            self.runtime(),
        )
        self.assertEqual(properties, [])

    def test_returns_at_most_three_matching_properties_without_scrolling(self):
        def raw_property(property_id, price):
            return FakeScript(f"""
            {{
              "@type": "House",
              "url": "https://www.vivareal.com.br/imovel/casa-2-quartos-centro-belo-horizonte-70m2-venda-RS{price}-id-{property_id}/",
              "offers": {{"price": {price}}},
              "address": {{"addressLocality": "Belo Horizonte", "addressRegion": "MG"}}
            }}
            """)

        driver = FakeDriver([
            raw_property("101", 500000),
            raw_property("102", 510000),
            raw_property("103", 520000),
            raw_property("104", 530000),
            raw_property("105", 540000),
        ])

        properties = VivaRealCollector().collect(
            driver,
            {"city": "Belo Horizonte", "state": "MG", "transaction": "SALE"},
            self.runtime(),
        )

        self.assertEqual(
            [property_data["source_id"] for property_data in properties],
            ["101", "102", "103"],
        )
        self.assertEqual(len(driver.opened_urls), 1)
        self.assertEqual(driver.execute_script_calls, 0)

    def test_contract_rejects_incomplete_property(self):
        with self.assertRaises(PermanentCollectorError):
            VivaRealCollector().validate_properties([
                {"source": "VIVAREAL", "source_id": "1", "url": "https://example"}
            ])


if __name__ == "__main__":
    unittest.main()
