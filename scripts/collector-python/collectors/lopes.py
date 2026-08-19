import re

from selenium.common.exceptions import (
    NoSuchElementException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from collectors.base import BaseCollector, TemporaryCollectorError
from collectors.portals import required_location
from collectors.vivareal import (
    clean_text,
    extract_money_from_text,
    extract_number_from_text,
    make_title,
    matches_search,
    slugify,
)


TYPE_PATHS = {
    "APARTMENT": "apartamento",
    "HOUSE": "casa",
    "PENTHOUSE": "cobertura",
    "COMMERCIAL_ROOM": "sala-comercial",
    "COMMERCIAL": "imovel-comercial",
}

TYPE_LABELS = {value: key for key, value in TYPE_PATHS.items()}


def build_lopes_search_url(criteria):
    city, state = required_location(criteria)
    action = "aluguel" if criteria.get("transaction") == "RENT" else "venda"
    type_slug = TYPE_PATHS.get(str(criteria.get("propertyType") or "").upper())
    url = f"https://www.lopes.com.br/busca/{action}/br/{state.lower()}/{slugify(city)}"
    return f"{url}/tipo/{type_slug}" if type_slug else url


def collect_lopes(driver, search_params=None, source="LOPES", limit=3):
    search_params = search_params or {}
    requested_transaction = search_params.get("transaction") or "SALE"
    city = search_params.get("city")
    state = search_params.get("state")

    cards = driver.find_elements(By.CSS_SELECTOR, "lps-search-product-card")

    properties = []

    for card in cards:
        if len(properties) >= limit:
            break

        try:
            link = card.find_element(By.CSS_SELECTOR, 'a[href*="/imovel/"]')
        except NoSuchElementException:
            continue

        href = link.get_attribute("href")
        match = re.search(r"/imovel/([A-Za-z0-9]+)/", href or "")
        if not match:
            continue
        source_id = match.group(1)

        def text_of(selector):
            try:
                return clean_text(card.find_element(By.CSS_SELECTOR, selector).text)
            except NoSuchElementException:
                return None

        price = extract_money_from_text(text_of("p.price"), [r"([\d\.,]+)"])

        type_label = TYPE_LABELS.get((text_of("h2.type") or "").lower(), "OTHER")

        usable_area = None
        bedrooms = None
        bathrooms = None
        parking_spaces = None
        for attribute in card.find_elements(By.CSS_SELECTOR, "ul.attributes li"):
            text = clean_text(attribute.text) or ""
            if "m²" in text:
                usable_area = extract_number_from_text(text, [r"(\d+)\s*m²"])
            elif "quarto" in text:
                bedrooms = extract_number_from_text(text, [r"(\d+)\s*quarto"])
            elif "banheiro" in text:
                bathrooms = extract_number_from_text(text, [r"(\d+)\s*banheiro"])
            elif "vaga" in text:
                parking_spaces = extract_number_from_text(text, [r"(\d+)\s*vaga"])

        condominium_fee = extract_money_from_text(
            text_of("ul.subprices"),
            [r"r\$\s*([\d.,]+)"],
        )

        street = None
        neighborhood = None
        location_text = text_of("span.location")
        if location_text:
            main_part = location_text.split(" - ")[0]
            parts = [part.strip() for part in main_part.split(",") if part.strip()]
            if parts:
                street = parts[0]
            if len(parts) > 1:
                neighborhood = parts[-1]

        description = text_of("div.description")

        image_url = None
        try:
            image_url = card.find_element(
                By.CSS_SELECTOR, ".image img"
            ).get_attribute("src")
        except NoSuchElementException:
            pass

        property_data = {
            "source": source,
            "source_id": source_id,
            "title": make_title(type_label, bedrooms, neighborhood, city),
            "advertiser_name": "Lopes",
            "description": description,
            "url": href,
            "image_url": image_url,
            "image_urls": [image_url] if image_url else [],
            "city": city,
            "state": state,
            "neighborhood": neighborhood,
            "street": street,
            "country": "BR",
            "date_posted": None,
            "sale_price": price if requested_transaction == "SALE" else None,
            "rental_price": price if requested_transaction == "RENT" else None,
            "usable_area": usable_area,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "suites": None,
            "parking_spaces": parking_spaces,
            "condominium_fee": condominium_fee,
            "iptu": None,
            "property_type": type_label,
        }

        if matches_search(property_data, search_params):
            properties.append(property_data)

    return properties


class LopesCollector(BaseCollector):
    source = "LOPES"
    name = "Lopes"

    def build_search_url(self, criteria):
        return build_lopes_search_url(criteria)

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

        properties = collect_lopes(
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
            return driver.find_elements(By.CSS_SELECTOR, "lps-search-product-card")

        return predicate
