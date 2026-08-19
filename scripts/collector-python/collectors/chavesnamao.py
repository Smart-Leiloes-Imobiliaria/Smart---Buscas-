import json
import re

from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from collectors.base import BaseCollector, TemporaryCollectorError
from collectors.portals import required_location
from collectors.vivareal import (
    clean_text,
    extract_number_from_text,
    item_money,
    item_number,
    matches_search,
    normalize_images,
    schema_property_type,
    slugify,
)


TYPE_PATHS = {
    "APARTMENT": "apartamentos",
    "HOUSE": "casas",
}


def build_chavesnamao_search_url(criteria):
    city, state = required_location(criteria)
    action = "para-alugar" if criteria.get("transaction") == "RENT" else "a-venda"
    type_slug = TYPE_PATHS.get(str(criteria.get("propertyType") or "").upper(), "imoveis")
    location = f"{state.lower()}-{slugify(city)}"
    return f"https://www.chavesnamao.com.br/{type_slug}-{action}/{location}/"


def collect_chavesnamao(driver, search_params=None, source="CHAVESNAMAO", limit=3):
    search_params = search_params or {}
    requested_transaction = search_params.get("transaction") or "SALE"
    city = search_params.get("city")
    state = search_params.get("state")

    offers = []
    for script in driver.find_elements(
        By.CSS_SELECTOR, 'script[type="application/ld+json"]'
    ):
        raw = script.get_attribute("innerHTML")
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if data.get("@type") != "RealEstateListing":
            continue
        offers = ((data.get("offers") or {}).get("itemListElement")) or []
        break

    properties = []

    for offer in offers:
        if len(properties) >= limit:
            break

        if not isinstance(offer, dict):
            continue

        url = offer.get("url")
        # Anúncios de "lançamento" (empreendimento) trazem faixas de preço e
        # quartos em vez de valores de um imóvel específico; só os anúncios
        # individuais (`/imovel/...`) têm dados normalizáveis com segurança.
        if not url or "/imovel/" not in url:
            continue

        match = re.search(r"/id-(\d+)/?", url)
        if not match:
            continue
        source_id = match.group(1)

        item = offer.get("itemOffered")
        if not isinstance(item, dict):
            item = {}

        address = item.get("address")
        if not isinstance(address, dict):
            address = {}

        street = clean_text(address.get("streetAddress"))
        if street:
            street = street.rstrip(", ").strip() or None
        if street and street.lower() == "não disponível":
            street = None

        floor_size = item.get("floorSize")
        usable_area = (
            extract_number_from_text(floor_size.get("unitText"), [r"(\d+)"])
            if isinstance(floor_size, dict)
            else None
        )

        image_urls = normalize_images(item.get("image") or offer.get("image"))
        price = item_money(offer.get("price"))

        property_data = {
            "source": source,
            "source_id": source_id,
            "title": clean_text(offer.get("name")),
            "advertiser_name": None,
            "description": None,
            "url": url,
            "image_url": image_urls[0] if image_urls else None,
            "image_urls": image_urls,
            "city": city,
            "state": state,
            "neighborhood": clean_text(address.get("addressLocality")),
            "street": street,
            "country": "BR",
            "date_posted": None,
            "sale_price": price if requested_transaction == "SALE" else None,
            "rental_price": price if requested_transaction == "RENT" else None,
            "usable_area": usable_area,
            "bedrooms": item_number(item.get("numberOfBedrooms")),
            "bathrooms": item_number(item.get("numberOfBathroomsTotal")),
            "suites": None,
            "parking_spaces": None,
            "condominium_fee": None,
            "iptu": None,
            "property_type": schema_property_type(item, url),
        }

        if matches_search(property_data, search_params):
            properties.append(property_data)

    return properties


class ChavesNaMaoCollector(BaseCollector):
    source = "CHAVESNAMAO"
    name = "Chaves na Mão"

    def build_search_url(self, criteria):
        return build_chavesnamao_search_url(criteria)

    def collect(self, driver, criteria, runtime):
        url = self.build_search_url(criteria)
        runtime.heartbeat(force=True)

        try:
            driver.get(url)
        except (TimeoutException, WebDriverException) as error:
            raise TemporaryCollectorError(
                f"{self.name}: não foi possível carregar a página: {error}"
            ) from error

        try:
            WebDriverWait(
                driver,
                runtime.wait_timeout_seconds(),
                poll_frequency=0.5,
            ).until(self._results_are_ready(runtime))
        except TimeoutException as error:
            raise TemporaryCollectorError(
                f"{self.name} não apresentou resultados no tempo esperado."
            ) from error

        properties = collect_chavesnamao(
            driver,
            criteria,
            source=self.source,
            limit=self.result_limit,
        )
        return self.validate_properties(properties)

    @staticmethod
    def _results_are_ready(runtime):
        def predicate(driver):
            runtime.heartbeat()
            return driver.find_elements(
                By.CSS_SELECTOR, 'script[type="application/ld+json"]'
            )

        return predicate
