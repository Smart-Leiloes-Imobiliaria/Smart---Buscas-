import json
import re
import html
import os
import unicodedata
from urllib.parse import urlencode

from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from collectors.base import (
    BaseCollector,
    BlockedCollectorError,
    TemporaryCollectorError,
)


def clean_text(value):
    if not value:
        return None

    value = html.unescape(str(value))
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)

    return value.strip()


def extract_id(url: str):
    match = re.search(r"-id-(\d+)/?", url or "")
    return match.group(1) if match else None


def extract_price(url: str):
    match = re.search(r"-RS(\d+)-id-", url or "")
    return int(match.group(1)) if match else None


def extract_area(url: str):
    match = re.search(r"-(\d+)m2-", url or "")
    return int(match.group(1)) if match else None


def extract_bedrooms(url: str):
    match = re.search(r"-(\d+)-quartos?", url or "")
    return int(match.group(1)) if match else None


def extract_parking_spaces(url: str):
    if not url:
        return None

    # Em muitos anúncios a URL só informa "com-garagem",
    # mas não informa quantas vagas existem.
    if "-com-garagem-" in url.lower():
        return 0

    return None


def slugify(value):
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


STATE_NAMES = {
    "AC": "acre", "AL": "alagoas", "AP": "amapa", "AM": "amazonas",
    "BA": "bahia", "CE": "ceara", "DF": "distrito-federal",
    "ES": "espirito-santo", "GO": "goias", "MA": "maranhao",
    "MT": "mato-grosso", "MS": "mato-grosso-do-sul", "MG": "minas-gerais",
    "PA": "para", "PB": "paraiba", "PR": "parana", "PE": "pernambuco",
    "PI": "piaui", "RJ": "rj", "RN": "rio-grande-do-norte",
    "RS": "rio-grande-do-sul", "RO": "rondonia", "RR": "roraima",
    "SC": "santa-catarina", "SP": "sp", "SE": "sergipe",
    "TO": "tocantins",
}


PROPERTY_TYPE_PATHS = {
    "APARTMENT": "apartamento_residencial",
    "HOUSE": "casa_residencial",
    "PENTHOUSE": "cobertura_residencial",
    "COMMERCIAL_ROOM": "sala_comercial",
    "COMMERCIAL": "imovel_comercial",
}


def build_vivareal_search_url(search_params):
    city = clean_text(search_params.get("city"))
    state = clean_text(search_params.get("state"))
    if not city or not state:
        raise ValueError("Cidade e estado são obrigatórios para pesquisar no Viva Real.")

    transaction = search_params.get("transaction", "SALE")
    action = "aluguel" if transaction == "RENT" else "venda"
    state_code = state.upper()
    state_slug = STATE_NAMES.get(state_code, slugify(state))
    city_slug = slugify(city)

    path_parts = [action, state_slug, city_slug]
    neighborhood = clean_text(search_params.get("neighborhood"))
    if neighborhood:
        path_parts.extend(["bairros", slugify(neighborhood)])

    property_type = str(search_params.get("propertyType") or "").upper()
    property_type_path = PROPERTY_TYPE_PATHS.get(property_type)
    if property_type_path:
        path_parts.append(property_type_path)

    query = {}
    min_price = search_params.get("minPrice")
    max_price = search_params.get("maxPrice")
    if min_price is not None:
        query["precoMinimo"] = min_price
    if max_price is not None:
        query["precoMaximo"] = max_price

    bedrooms = search_params.get("bedrooms")
    if bedrooms is not None:
        query["quartos"] = bedrooms

    min_area = search_params.get("minArea")
    if min_area is None:
        min_area = search_params.get("min_area")
    max_area = search_params.get("maxArea")
    if max_area is None:
        max_area = search_params.get("max_area")
    if min_area is not None:
        query["areaMinima"] = min_area
    if max_area is not None:
        query["areaMaxima"] = max_area

    url = f"https://www.vivareal.com.br/{'/'.join(path_parts)}/"
    return f"{url}?{urlencode(query)}" if query else url


def extract_neighborhood(url: str, city):
    if not url:
        return None

    try:
        path = url.split("/imovel/", 1)[1]
    except IndexError:
        return None

    # Ex:
    # apartamento-2-quartos-castelo-belo-horizonte-com-garagem...
    city_slug = re.escape(slugify(city))
    match = re.search(
        r"^(?:apartamento|casa|casa-de-condominio|sobrado|cobertura|sala-comercial|imovel-comercial)"
        rf"-\d+-quartos?-([a-z0-9-]+?)-{city_slug}(?:-|$)",
        path.lower(),
    )

    if not match:
        return None

    neighborhood = match.group(1)

    return neighborhood.replace("-", " ").title()


def extract_property_type(url: str):
    if not url:
        return None

    path = url.lower()

    if "/apartamento-" in path:
        return "APARTMENT"

    if any(value in path for value in ("/casa-", "/casa-de-condominio-", "/sobrado-")):
        return "HOUSE"

    if "/cobertura-" in path:
        return "PENTHOUSE"

    if "/sala-comercial-" in path:
        return "COMMERCIAL_ROOM"

    if "/imovel-comercial-" in path:
        return "COMMERCIAL"

    return "OTHER"


def extract_transaction(url: str):
    path = (url or "").lower()
    if "-aluguel-" in path or "/aluguel/" in path or "/alugar/" in path:
        return "RENT"
    if "-venda-" in path or "/venda/" in path or "/comprar/" in path:
        return "SALE"
    return None


def extract_generic_id(url, item):
    identifiers = [
        extract_id(url),
        item.get("sku"),
        item.get("productID"),
        item.get("identifier"),
    ]
    patterns = (
        r"/imovel/(\d+)(?:/|$)",
        r"-(\d{7,})(?:\.html)?(?:[/?#]|$)",
        r"/(\d{7,})(?:[/?#]|$)",
    )
    for pattern in patterns:
        match = re.search(pattern, url or "", re.IGNORECASE)
        if match:
            identifiers.append(match.group(1))

    item_id = item.get("@id")
    if item_id and item_id != url:
        identifiers.append(item_id)

    return next((str(value) for value in identifiers if value), None)


def schema_property_type(item, url):
    schema_type = str(item.get("@type") or "").lower()
    if "apartment" in schema_type:
        return "APARTMENT"
    if "house" in schema_type or "singlefamily" in schema_type:
        return "HOUSE"
    return extract_property_type(url)


def address_parts(address, url, city):
    raw_street = clean_text(address.get("streetAddress"))
    street_parts = [
        value.strip()
        for value in (raw_street or "").split(",")
        if value.strip()
    ]
    neighborhood = clean_text(
        address.get("addressNeighborhood")
        or address.get("district")
    )
    if not neighborhood and len(street_parts) > 1:
        candidate = street_parts[-1]
        if slugify(candidate) != slugify(city):
            neighborhood = candidate
    if not neighborhood:
        neighborhood = extract_neighborhood(url, city)
    return (street_parts[0] if street_parts else raw_street), neighborhood


def normalize_images(image):
    if not image:
        return []

    if isinstance(image, str):
        return [image]

    if isinstance(image, list):
        return [
            img
            for img in image
            if isinstance(img, str) and img.strip()
        ]

    if isinstance(image, dict):
        url = image.get("url") or image.get("contentUrl")

        return [url] if url else []

    return []


def extract_number_from_text(text, patterns):
    if not text:
        return None

    normalized = clean_text(text)

    for pattern in patterns:
        match = re.search(
            pattern,
            normalized,
            re.IGNORECASE,
        )

        if match:
            try:
                return int(match.group(1))
            except (TypeError, ValueError):
                continue

    return None


def extract_money_from_text(text, patterns):
    if not text:
        return None

    normalized = clean_text(text)

    for pattern in patterns:
        match = re.search(
            pattern,
            normalized,
            re.IGNORECASE,
        )

        if not match:
            continue

        value = match.group(1)

        value = (
            value
            .replace(".", "")
            .replace(",", ".")
            .strip()
        )

        try:
            return float(value)
        except ValueError:
            continue

    return None


def extract_bathrooms(description):
    return extract_number_from_text(
        description,
        [
            r"(\d+)\s+banheiros?",
            r"(\d+)\s+banheiro",
        ],
    )


def extract_suites(description):
    return extract_number_from_text(
        description,
        [
            r"(\d+)\s+su[ií]tes?",
            r"(\d+)\s+su[ií]te",
        ],
    )


def extract_parking_from_description(description):
    return extract_number_from_text(
        description,
        [
            r"(\d+)\s+vagas?",
            r"(\d+)\s+vagas?\s+de\s+garagem",
        ],
    )


def extract_condominium(description):
    return extract_money_from_text(
        description,
        [
            r"condom[ií]nio[:\s]+r?\$?\s*([\d\.,]+)",
            r"cond\.?[:\s]+r?\$?\s*([\d\.,]+)",
        ],
    )


def extract_iptu(description):
    return extract_money_from_text(
        description,
        [
            r"iptu[:\s]+r?\$?\s*([\d\.,]+)",
        ],
    )


def make_title(property_type, bedrooms, neighborhood, city):
    pieces = []

    type_labels = {
        "APARTMENT": "Apartamento",
        "HOUSE": "Casa",
        "PENTHOUSE": "Cobertura",
        "COMMERCIAL_ROOM": "Sala comercial",
        "COMMERCIAL": "Imóvel comercial",
        "OTHER": "Imóvel",
    }

    pieces.append(
        type_labels.get(property_type, "Imóvel")
    )

    if bedrooms:
        pieces.append(
            f"{bedrooms} quarto"
            if bedrooms == 1
            else f"{bedrooms} quartos"
        )

    location = []

    if neighborhood:
        location.append(neighborhood)

    if city:
        location.append(city)

    title = " com ".join(pieces)

    if location:
        title += " em " + ", ".join(location)

    return title


def matches_search(property_data, search_params):
    if not search_params:
        return True

    def same_text(left, right):
        return slugify(left) == slugify(right)
        

    city = search_params.get("city")
    if city and property_data.get("city") and not same_text(property_data["city"], city):
        return False

    neighborhood = search_params.get("neighborhood")
    if neighborhood and not same_text(property_data.get("neighborhood"), neighborhood):
        return False

    property_type = search_params.get("propertyType") or search_params.get("property_type")
    if property_type and property_data.get("property_type") != str(property_type).upper():
        return False

    bedrooms = search_params.get("bedrooms")
    if bedrooms is not None and (property_data.get("bedrooms") or 0) < int(bedrooms):
        return False

    usable_area = property_data.get("usable_area")
    min_area = search_params.get("minArea")
    if min_area is None:
        min_area = search_params.get("min_area")
    max_area = search_params.get("maxArea")
    if max_area is None:
        max_area = search_params.get("max_area")
    if min_area is not None and (
        usable_area is None or usable_area < float(min_area)
    ):
        return False
    if max_area is not None and (
        usable_area is None or usable_area > float(max_area)
    ):
        return False

    price_field = "rental_price" if search_params.get("transaction") == "RENT" else "sale_price"
    price = property_data.get(price_field)
    min_price = search_params.get("minPrice")
    if min_price is None:
        min_price = search_params.get("min_price")
    max_price = search_params.get("maxPrice")
    if max_price is None:
        max_price = search_params.get("max_price")
    if min_price is not None and (price is None or price < float(min_price)):
        return False
    if max_price is not None and (price is None or price > float(max_price)):
        return False

    return True


def iter_jsonld_items(data):
    if isinstance(data, list):
        for value in data:
            yield from iter_jsonld_items(value)
        return

    if not isinstance(data, dict):
        return

    graph = data.get("@graph")
    if isinstance(graph, list):
        yield from iter_jsonld_items(graph)

    if data.get("@type") == "ItemList":
        for wrapper in data.get("itemListElement") or []:
            if isinstance(wrapper, dict):
                yield from iter_jsonld_items(wrapper.get("item", wrapper))
        return

    main_entity = data.get("mainEntity")
    if main_entity:
        yield from iter_jsonld_items(main_entity)

    if data.get("url"):
        yield data


def item_number(value):
    if isinstance(value, dict):
        value = value.get("value")
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def item_money(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_offer(item):
    offers = item.get("offers")
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    return offers if isinstance(offers, dict) else {}


def extract_condominium_from_offer(offer):
    properties = offer.get("additionalProperty")
    if isinstance(properties, dict):
        properties = [properties]
    for value in properties or []:
        if not isinstance(value, dict):
            continue
        name = str(value.get("name") or "").lower()
        if "condom" in name:
            return item_money(value.get("value"))
    return None


def property_richness(property_data):
    fields = (
        "title", "description", "sale_price", "rental_price", "city",
        "neighborhood", "bedrooms", "bathrooms", "suites",
        "parking_spaces", "usable_area", "condominium_fee", "iptu",
    )
    return sum(property_data.get(field) is not None for field in fields) + len(
        property_data.get("image_urls") or []
    )


def collect_vivareal(driver, search_params=None, source="VIVAREAL"):
    scripts = driver.find_elements(
        By.CSS_SELECTOR,
        'script[type="application/ld+json"]',
    )

    properties_by_id = {}

    for script in scripts:
        raw = script.get_attribute("innerHTML")

        if not raw:
            continue

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue

        for item in iter_jsonld_items(data):
                url = item.get("url")

                if not url:
                    continue

                property_id = extract_generic_id(url, item)

                if not property_id:
                    continue

                property_id = str(property_id)

                requested_transaction = (
                    (search_params or {}).get("transaction") or "SALE"
                )
                listing_transaction = (
                    extract_transaction(url) or requested_transaction
                )
                if listing_transaction != requested_transaction:
                    continue

                details = item.get("about")
                if not isinstance(details, dict):
                    details = item

                description = clean_text(item.get("description"))

                address = details.get("address") or item.get("address")
                if not isinstance(address, dict):
                    address = {}

                content_location = item.get("contentLocation")
                if isinstance(content_location, dict):
                    content_location = content_location.get("name")

                city = clean_text(
                    content_location
                    or address.get("addressLocality")
                    or (search_params or {}).get("city")
                )

                bedrooms = (
                    item_number(details.get("numberOfBedrooms"))
                    or item_number(details.get("numberOfRooms"))
                    or extract_bedrooms(url)
                )
                usable_area = (
                    item_number(details.get("floorSize"))
                    or extract_area(url)
                )
                offer = extract_offer(item) or extract_offer(details)
                collected_price = (
                    item_money(offer.get("price"))
                    or extract_price(url)
                )

                property_type = schema_property_type(details, url)
                requested_city = search_params.get("city") if search_params else city
                street, neighborhood = address_parts(
                    address,
                    url,
                    requested_city,
                )

                parking_spaces = (
                    item_number(details.get("numberOfParkingSpaces"))
                    or extract_parking_from_description(description)
                    or extract_parking_spaces(url)
                )

                bathrooms = (
                    item_number(details.get("numberOfBathroomsTotal"))
                    or item_number(details.get("numberOfFullBathrooms"))
                    or extract_bathrooms(description)
                )
                suites = extract_suites(description)

                condominium_fee = (
                    extract_condominium_from_offer(offer)
                    or extract_condominium(description)
                )

                iptu = extract_iptu(description)

                image_urls = normalize_images(
                    item.get("image")
                )

                title = (
                    clean_text(item.get("name"))
                    or make_title(
                        property_type,
                        bedrooms,
                        neighborhood,
                        city,
                    )
                )

                seller = item.get("seller")
                advertiser_name = (
                    clean_text(seller.get("name"))
                    if isinstance(seller, dict)
                    else None
                )

                property_data = {
                    "source": source,
                    "source_id": property_id,

                    "title": title,

                    "advertiser_name": advertiser_name,

                    "description": description,

                    "url": url,

                    "image_url": (
                        image_urls[0]
                        if image_urls
                        else None
                    ),

                    "image_urls": image_urls,

                    "city": city,
                    "state": clean_text(
                        address.get("addressRegion")
                        or (search_params or {}).get("state")
                    ),
                    "neighborhood": neighborhood,
                    "street": street,

                    "country": clean_text(
                        details.get("countryOfOrigin")
                        or item.get("countryOfOrigin")
                        or address.get("addressCountry")
                    ),

                    "date_posted": item.get("datePosted") or details.get("datePosted"),

                    "sale_price": (
                        collected_price
                        if listing_transaction == "SALE"
                        else None
                    ),

                    "rental_price": (
                        collected_price
                        if listing_transaction == "RENT"
                        else None
                    ),

                    "usable_area": usable_area,

                    "bedrooms": bedrooms,
                    "bathrooms": bathrooms,
                    "suites": suites,

                    "parking_spaces": parking_spaces,

                    "condominium_fee": condominium_fee,
                    "iptu": iptu,

                    "property_type": property_type,
                }

                if matches_search(property_data, search_params):
                    existing = properties_by_id.get(property_id)
                    if (
                        existing is None
                        or property_richness(property_data)
                        > property_richness(existing)
                    ):
                        properties_by_id[property_id] = property_data

    return list(properties_by_id.values())


def is_vivareal_blocked(driver):
    title = (driver.title or "").lower()
    page_source = (driver.page_source or "").lower()
    return (
        "attention required" in title
        or "just a moment" in title
        or "cf-error-details" in page_source
        or "cf-chl-" in page_source
    )


class VivaRealCollector(BaseCollector):
    source = "VIVAREAL"
    name = "Viva Real"

    def build_search_url(self, criteria):
        return build_vivareal_search_url(criteria)

    def collect(self, driver, criteria, runtime):
        search_url = self.build_search_url(criteria)
        self._open_page(driver, search_url, runtime)
        runtime.heartbeat(force=True)
        properties = collect_vivareal(
            driver,
            criteria,
            source=self.source,
        )[: self.result_limit]
        return self.validate_properties(properties)

    def _open_page(self, driver, url, runtime):
        runtime.heartbeat(force=True)

        try:
            driver.get(url)
        except (TimeoutException, WebDriverException) as error:
            raise TemporaryCollectorError(
                f"{self.name}: não foi possível carregar a página: {error}"
            ) from error

        if is_vivareal_blocked(driver):
            self._raise_blocked()

        try:
            WebDriverWait(
                driver,
                runtime.wait_timeout_seconds(),
                poll_frequency=0.5,
            ).until(self._results_are_ready(runtime))
        except TimeoutException as error:
            if is_vivareal_blocked(driver):
                self._raise_blocked(error)
            raise TemporaryCollectorError(
                "O Viva Real não apresentou resultados no tempo esperado."
            ) from error

    def _raise_blocked(self, cause=None):
        error = BlockedCollectorError(
            f"O {self.name} bloqueou temporariamente o acesso automatizado.",
            retry_after_seconds=float(
                os.getenv("COLLECTOR_BLOCK_RETRY_SECONDS", "120")
            ),
        )
        if cause:
            raise error from cause
        raise error

    @staticmethod
    def _results_are_ready(runtime):
        def predicate(driver):
            runtime.heartbeat()
            return driver.find_elements(
                By.CSS_SELECTOR,
                'script[type="application/ld+json"]',
            )

        return predicate
