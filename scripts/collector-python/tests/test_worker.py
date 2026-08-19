import unittest
from unittest.mock import Mock, patch

import worker
from collectors.base import BlockedCollectorError, TemporaryCollectorError


def search(attempts=0):
    return {
        "id": "84bd70a8-8638-4586-99d0-87ab4bac17ac",
        "criteria": {"city": "Belo Horizonte", "state": "MG"},
        "attempts": attempts,
    }


class WorkerTests(unittest.TestCase):
    def settings(self, max_attempts=3):
        return {
            "max_attempts": max_attempts,
            "retry_base_seconds": 2,
            "retry_max_seconds": 10,
            "job_timeout_seconds": 30,
            "element_timeout_seconds": 1,
            "heartbeat_interval_seconds": 1,
            "stale_after_seconds": 60,
        }

    def test_retry_delay_uses_capped_exponential_backoff(self):
        settings = self.settings()
        self.assertEqual(worker.retry_delay_seconds(1, settings), 2)
        self.assertEqual(worker.retry_delay_seconds(2, settings), 4)
        self.assertEqual(worker.retry_delay_seconds(5, settings), 10)

    def test_portal_block_uses_the_longer_requested_delay(self):
        error = BlockedCollectorError("blocked", retry_after_seconds=120)
        self.assertEqual(
            worker.retry_delay_for_error(1, self.settings(), error),
            120,
        )

    def test_limits_each_portal_and_links_only_cross_source_unique_results(self):
        def listing(source, source_id, street):
            return {
                "source": source,
                "source_id": source_id,
                "city": "Belo Horizonte",
                "state": "MG",
                "neighborhood": "Castelo",
                "street": street,
                "description": None,
                "sale_price": 650000,
                "rental_price": None,
                "usable_area": 85,
                "bedrooms": 3,
                "bathrooms": 2,
                "suites": 1,
                "parking_spaces": 2,
                "property_type": "APARTMENT",
            }

        viva_real = Mock(name="viva_real", result_limit=3)
        viva_real.name = "Viva Real"
        viva_real.build_search_url.return_value = "https://vivareal.example"
        viva_real.collect.return_value = [
            listing("VIVAREAL", "vr-1", "Rua A, 10"),
            listing("VIVAREAL", "vr-2", "Rua B, 20"),
            listing("VIVAREAL", "vr-3", "Rua C, 30"),
            listing("VIVAREAL", "vr-4", "Rua D, 40"),
        ]
        zap = Mock(name="zap", result_limit=3)
        zap.name = "Zap"
        zap.build_search_url.return_value = "https://zap.example"
        zap.collect.return_value = [
            listing("ZAP", "zap-1", "R. A, 10"),
            listing("ZAP", "zap-2", "Rua E, 50"),
            listing("ZAP", "zap-3", "Rua F, 60"),
            listing("ZAP", "zap-4", "Rua G, 70"),
        ]

        with (
            patch("worker.collector_settings", return_value=self.settings()),
            patch("worker.recover_stale_searches"),
            patch("worker.claim_property_search", return_value=search(attempts=1)),
            patch("worker.get_enabled_collectors", return_value=[viva_real, zap]),
            patch("worker.get_disabled_source_codes", return_value=set()),
            patch("worker.create_browser", side_effect=[Mock(), Mock()]),
            patch("worker.heartbeat_property_search"),
            patch("worker.upsert_properties") as upsert,
            patch("worker.link_property_search_results", return_value=list(range(5))) as link,
            patch("worker.complete_property_search") as complete,
            patch("worker.fail_property_search") as fail,
        ):
            result = worker.process_property_search("search-id")

        stored = upsert.call_args.args[0]
        displayed = link.call_args.args[1]
        self.assertEqual(len(stored), 6)
        self.assertEqual(len(displayed), 5)
        self.assertNotIn("vr-4", {item["source_id"] for item in stored})
        self.assertNotIn("zap-1", {item["source_id"] for item in displayed})
        complete.assert_called_once_with(search()["id"], 5)
        fail.assert_not_called()
        self.assertEqual(result["properties_found"], 5)

    def test_source_paused_in_admin_panel_is_skipped(self):
        viva_real = Mock(name="viva_real", result_limit=3, source="VIVAREAL")
        viva_real.name = "Viva Real"
        viva_real.build_search_url.return_value = "https://vivareal.example"
        viva_real.collect.return_value = [
            {
                "source": "VIVAREAL",
                "source_id": "vr-1",
                "city": "Belo Horizonte",
                "state": "MG",
                "neighborhood": "Castelo",
                "street": "Rua A, 10",
                "description": None,
                "sale_price": 650000,
                "rental_price": None,
                "usable_area": 85,
                "bedrooms": 3,
                "bathrooms": 2,
                "suites": 1,
                "parking_spaces": 2,
                "property_type": "APARTMENT",
            }
        ]
        zap = Mock(name="zap", result_limit=3, source="ZAP")
        zap.name = "Zap"

        with (
            patch("worker.collector_settings", return_value=self.settings()),
            patch("worker.recover_stale_searches"),
            patch("worker.claim_property_search", return_value=search(attempts=1)),
            patch("worker.get_enabled_collectors", return_value=[viva_real, zap]),
            patch("worker.get_disabled_source_codes", return_value={"ZAP"}),
            patch("worker.create_browser", return_value=Mock()),
            patch("worker.heartbeat_property_search"),
            patch("worker.upsert_properties") as upsert,
            patch("worker.link_property_search_results", return_value=[1]),
            patch("worker.complete_property_search") as complete,
            patch("worker.fail_property_search") as fail,
        ):
            worker.process_property_search("search-id")

        zap.collect.assert_not_called()
        viva_real.collect.assert_called_once()
        stored = upsert.call_args.args[0]
        self.assertEqual({item["source"] for item in stored}, {"VIVAREAL"})
        complete.assert_called_once_with(search()["id"], 1)
        fail.assert_not_called()

    def test_completes_with_available_portal_when_another_is_blocked(self):
        blocked = Mock(name="blocked", result_limit=3)
        blocked.name = "Portal bloqueado"
        blocked.build_search_url.return_value = "https://blocked.example"
        blocked.collect.side_effect = BlockedCollectorError("blocked", 120)

        available = Mock(name="available", result_limit=3)
        available.name = "Portal disponível"
        available.build_search_url.return_value = "https://available.example"
        available.collect.return_value = [{
            "source": "AVAILABLE",
            "source_id": "1",
            "city": "Belo Horizonte",
            "state": "MG",
            "neighborhood": "Castelo",
            "street": "Rua A, 10",
            "description": None,
            "sale_price": 500000,
            "rental_price": None,
            "usable_area": 70,
            "bedrooms": 2,
            "bathrooms": 1,
            "suites": None,
            "parking_spaces": 1,
            "property_type": "APARTMENT",
        }]

        with (
            patch("worker.collector_settings", return_value=self.settings()),
            patch("worker.recover_stale_searches"),
            patch("worker.claim_property_search", return_value=search(attempts=1)),
            patch("worker.get_enabled_collectors", return_value=[blocked, available]),
            patch("worker.get_disabled_source_codes", return_value=set()),
            patch("worker.create_browser", side_effect=[Mock(), Mock()]),
            patch("worker.heartbeat_property_search"),
            patch("worker.upsert_properties"),
            patch("worker.link_property_search_results", return_value=[1]),
            patch("worker.complete_property_search") as complete,
            patch("worker.retry_property_search") as retry,
            patch("worker.fail_property_search") as fail,
        ):
            result = worker.process_property_search("search-id")

        self.assertEqual(result["status"], "COMPLETED")
        complete.assert_called_once_with(search()["id"], 1)
        retry.assert_not_called()
        fail.assert_not_called()

    @patch("worker.recover_stale_searches")
    @patch("worker.collector_settings")
    @patch("worker.retry_property_search")
    @patch("worker.fail_property_search")
    @patch("worker.create_browser")
    @patch("worker.get_disabled_source_codes")
    @patch("worker.get_enabled_collectors")
    @patch("worker.claim_property_search")
    def test_temporary_failure_is_scheduled_for_retry(
        self,
        claim,
        enabled,
        disabled_sources,
        create_browser,
        fail,
        retry,
        settings,
        recover,
    ):
        settings.return_value = self.settings()
        claim.return_value = search(attempts=1)
        collector = Mock(name="collector")
        collector.name = "Portal"
        collector.build_search_url.return_value = "https://example"
        collector.collect.side_effect = TemporaryCollectorError("timeout")
        enabled.return_value = [collector]
        disabled_sources.return_value = set()
        create_browser.return_value = Mock()

        result = worker.process_property_search("search-id")

        self.assertEqual(result["status"], "RETRYING")
        retry.assert_called_once()
        fail.assert_not_called()

    @patch("worker.recover_stale_searches")
    @patch("worker.collector_settings")
    @patch("worker.retry_property_search")
    @patch("worker.fail_property_search")
    @patch("worker.create_browser")
    @patch("worker.get_disabled_source_codes")
    @patch("worker.get_enabled_collectors")
    @patch("worker.claim_property_search")
    def test_last_temporary_failure_becomes_failed(
        self,
        claim,
        enabled,
        disabled_sources,
        create_browser,
        fail,
        retry,
        settings,
        recover,
    ):
        settings.return_value = self.settings(max_attempts=3)
        claim.return_value = search(attempts=3)
        collector = Mock(name="collector")
        collector.name = "Portal"
        collector.build_search_url.return_value = "https://example"
        collector.collect.side_effect = TemporaryCollectorError("timeout")
        enabled.return_value = [collector]
        disabled_sources.return_value = set()
        create_browser.return_value = Mock()

        result = worker.process_property_search("search-id")

        self.assertEqual(result["status"], "FAILED")
        retry.assert_not_called()
        fail.assert_called_once()


if __name__ == "__main__":
    unittest.main()
