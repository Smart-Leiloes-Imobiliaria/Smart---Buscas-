import unittest

from collectors.deduplication import (
    AUTOMATIC_MATCH_SCORE,
    deduplicate_cross_source,
    property_similarity,
)


def property_data(source, source_id, **overrides):
    data = {
        "source": source,
        "source_id": source_id,
        "title": "Apartamento 3 quartos no bairro Castelo",
        "description": None,
        "sale_price": 650000,
        "rental_price": None,
        "city": "Belo Horizonte",
        "state": "MG",
        "neighborhood": "Castelo",
        "street": "Rua Castelo de Lisboa, 120",
        "bedrooms": 3,
        "bathrooms": 2,
        "suites": 1,
        "parking_spaces": 2,
        "usable_area": 85,
        "property_type": "APARTMENT",
    }
    data.update(overrides)
    return data


class DeduplicationTests(unittest.TestCase):
    def test_removes_same_property_published_by_different_portals(self):
        viva_real = property_data("VIVAREAL", "vr-1")
        zap = property_data(
            "ZAP",
            "zap-9",
            street="R. Castelo de Lisboa, 120",
            usable_area=87,
        )

        unique, duplicates = deduplicate_cross_source([viva_real, zap])

        self.assertEqual(unique, [viva_real])
        self.assertEqual(len(duplicates), 1)
        self.assertGreaterEqual(duplicates[0]["score"], AUTOMATIC_MATCH_SCORE)

    def test_keeps_different_listings_from_the_same_portal(self):
        first = property_data("VIVAREAL", "vr-1")
        second = property_data("VIVAREAL", "vr-2")

        unique, duplicates = deduplicate_cross_source([first, second])

        self.assertEqual(unique, [first, second])
        self.assertEqual(duplicates, [])

    def test_keeps_properties_with_different_addresses(self):
        first = property_data("VIVAREAL", "vr-1")
        second = property_data(
            "ZAP",
            "zap-9",
            street="Rua Castelo de Sintra, 400",
        )

        self.assertEqual(property_similarity(first, second), 0)
        unique, _ = deduplicate_cross_source([first, second])
        self.assertEqual(unique, [first, second])

    def test_keeps_sale_and_rent_as_separate_results(self):
        sale = property_data("VIVAREAL", "vr-1")
        rent = property_data(
            "ZAP",
            "zap-9",
            sale_price=None,
            rental_price=3500,
        )

        self.assertEqual(property_similarity(sale, rent), 0)


if __name__ == "__main__":
    unittest.main()
