import os

from collectors.base import PermanentCollectorError
from collectors.chavesnamao import ChavesNaMaoCollector
from collectors.lopes import LopesCollector
from collectors.portals import (
    CasaMineiraCollector,
    ImovelwebCollector,
    QuintoAndarCollector,
    ZapCollector,
)
from collectors.vivareal import VivaRealCollector


COLLECTORS = {
    "VIVAREAL": VivaRealCollector(),
    "ZAP": ZapCollector(),
    "IMOVELWEB": ImovelwebCollector(),
    "CASAMINEIRA": CasaMineiraCollector(),
    "QUINTOANDAR": QuintoAndarCollector(),
    "LOPES": LopesCollector(),
    "CHAVESNAMAO": ChavesNaMaoCollector(),
}


def get_enabled_collectors():
    configured = os.getenv(
        "COLLECTOR_SOURCES",
        "VIVAREAL,QUINTOANDAR,LOPES,CHAVESNAMAO",
    )
    source_codes = [
        value.strip().upper()
        for value in configured.split(",")
        if value.strip()
    ]

    if not source_codes:
        raise PermanentCollectorError(
            "COLLECTOR_SOURCES deve habilitar ao menos um portal."
        )

    unknown = [code for code in source_codes if code not in COLLECTORS]
    if unknown:
        raise PermanentCollectorError(
            "Collectors não registrados: " + ", ".join(unknown)
        )

    return [COLLECTORS[code] for code in source_codes]
