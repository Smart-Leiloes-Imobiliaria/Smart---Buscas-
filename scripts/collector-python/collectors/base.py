import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable


PROPERTY_FIELDS = frozenset({
    "source",
    "source_id",
    "title",
    "advertiser_name",
    "description",
    "sale_price",
    "rental_price",
    "city",
    "state",
    "neighborhood",
    "street",
    "bedrooms",
    "bathrooms",
    "suites",
    "parking_spaces",
    "usable_area",
    "condominium_fee",
    "iptu",
    "property_type",
    "image_url",
    "image_urls",
    "url",
    "country",
    "date_posted",
})


class CollectorError(RuntimeError):
    """Erro conhecido durante uma coleta."""


class TemporaryCollectorError(CollectorError):
    """Falha transitória que pode ser tentada novamente."""


class BlockedCollectorError(TemporaryCollectorError):
    """O portal pediu redução de frequência ou bloqueou a automação."""

    def __init__(self, message, retry_after_seconds):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class PermanentCollectorError(CollectorError):
    """Falha de configuração ou dados que não deve ser repetida."""


@dataclass
class CollectorRuntime:
    deadline: float
    element_timeout_seconds: float
    heartbeat_callback: Callable[[], None]
    heartbeat_interval_seconds: float = 15
    _last_heartbeat: float = field(default=0, init=False)

    def remaining_seconds(self):
        return max(0, self.deadline - time.monotonic())

    def ensure_active(self):
        if self.remaining_seconds() <= 0:
            raise TemporaryCollectorError(
                "A coleta excedeu o tempo máximo configurado."
            )

    def heartbeat(self, force=False):
        self.ensure_active()
        now = time.monotonic()
        if force or now - self._last_heartbeat >= self.heartbeat_interval_seconds:
            self.heartbeat_callback()
            self._last_heartbeat = now

    def wait_timeout_seconds(self):
        self.ensure_active()
        return max(
            0.1,
            min(self.element_timeout_seconds, self.remaining_seconds()),
        )


class BaseCollector(ABC):
    source: str
    name: str
    result_limit = 3

    @abstractmethod
    def build_search_url(self, criteria):
        raise NotImplementedError

    @abstractmethod
    def collect(self, driver, criteria, runtime):
        raise NotImplementedError

    def validate_properties(self, properties):
        normalized = []

        for index, property_data in enumerate(properties):
            missing = PROPERTY_FIELDS.difference(property_data)
            if missing:
                fields = ", ".join(sorted(missing))
                raise PermanentCollectorError(
                    f"{self.name}: imóvel {index} sem os campos obrigatórios: {fields}."
                )

            if property_data["source"] != self.source:
                raise PermanentCollectorError(
                    f"{self.name}: origem inválida no imóvel {index}."
                )

            if not property_data["source_id"] or not property_data["url"]:
                raise PermanentCollectorError(
                    f"{self.name}: imóvel {index} sem identificador ou URL."
                )

            normalized.append(property_data)

        return normalized
