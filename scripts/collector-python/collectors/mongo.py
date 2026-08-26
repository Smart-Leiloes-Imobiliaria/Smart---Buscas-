import os
from datetime import datetime

from collectors.base import BaseCollector, PermanentCollectorError, TemporaryCollectorError
from collectors.vivareal import clean_text, item_money, item_number, matches_search


DEFAULT_DATABASE = "smart_app"
DEFAULT_COLLECTION_CANDIDATES = (
    "imoveis",
    "properties",
    "real_estate_properties",
    "listings",
    "anuncios",
)


class MongoCollector(BaseCollector):
    source = "MONGO"
    name = "MongoDB"
    result_limit = 3
    uses_browser = False

    def build_search_url(self, criteria):
        database = os.getenv("MONGODB_DATABASE", DEFAULT_DATABASE)
        collection = os.getenv("MONGODB_PROPERTIES_COLLECTION", "imoveis")
        return f"mongodb://{database}/{collection}"

    def collect(self, driver, criteria, runtime):
        del driver
        runtime.heartbeat(force=True)

        uri = os.getenv("MONGODB_URI", "").strip()
        if not uri:
            raise TemporaryCollectorError(
                "MongoDB: MONGODB_URI não configurado neste ambiente."
            )

        try:
            from pymongo import MongoClient
            from pymongo.errors import PyMongoError
        except ImportError as error:
            raise PermanentCollectorError(
                "MongoDB: dependência pymongo ausente. Instale requirements.txt do coletor."
            ) from error

        timeout_ms = int(os.getenv("MONGODB_TIMEOUT_MS", "10000"))
        try:
            with MongoClient(
                uri,
                serverSelectionTimeoutMS=timeout_ms,
            ) as client:
                database = client[os.getenv("MONGODB_DATABASE", DEFAULT_DATABASE)]
                collection_name = resolve_collection_name(database)
                if not collection_name:
                    return []

                collection = database[collection_name]
                docs = list(
                    collection.find(
                        build_candidate_filter(criteria),
                        projection=mongo_projection(),
                        limit=int(os.getenv("MONGODB_CANDIDATE_LIMIT", "80")),
                        max_time_ms=timeout_ms,
                    )
                )
        except PyMongoError as error:
            raise TemporaryCollectorError(f"MongoDB: consulta indisponível: {error}") from error

        properties = []
        for doc in docs:
            property_data = document_to_property(doc, criteria)
            if property_data and matches_search(property_data, criteria):
                properties.append(property_data)

        return self.validate_properties(properties[: self.result_limit])


def resolve_collection_name(database):
    configured = os.getenv("MONGODB_PROPERTIES_COLLECTION", "").strip()
    candidates = (configured,) if configured else DEFAULT_COLLECTION_CANDIDATES

    for name in candidates:
        if not name:
            continue
        try:
            if database[name].find_one({}, {"_id": 1}) is not None:
                return name
        except Exception:
            if configured:
                raise
            continue
    return None


def build_candidate_filter(criteria):
    filters = []
    city = clean_text(criteria.get("city"))
    if city:
        # A coleção usa nomes de cidades sem acentos e em maiúsculas. Essa
        # igualdade evita um scan caro por regex no Atlas.
        filters.append({"cidade": normalize_lookup_text(city)})

    state = clean_text(criteria.get("state"))
    if state:
        filters.append({"estado": state.upper()})

    # Documentos inativos não devem entrar na busca nem consumir o limite de
    # candidatos antes da filtragem final.
    filters.append({"ativo": {"$ne": False}})

    neighborhood = clean_text(criteria.get("neighborhood"))
    if neighborhood:
        filters.append(
            {
                "$or": [
                    {"bairro": {"$regex": neighborhood, "$options": "i"}},
                    {"endereco": {"$regex": neighborhood, "$options": "i"}},
                    {"descricao": {"$regex": neighborhood, "$options": "i"}},
                ]
            }
        )

    return {"$and": filters} if filters else {}


def normalize_lookup_text(value):
    import unicodedata

    normalized = unicodedata.normalize("NFKD", value or "")
    return normalized.encode("ascii", "ignore").decode("ascii").upper()


def mongo_projection():
    return {
        "_id": 1,
        "area_construida": 1,
        "area_util": 1,
        "area_total": 1,
        "ativo": 1,
        "bairro": 1,
        "banheiros": 1,
        "cidade": 1,
        "descricao": 1,
        "endereco": 1,
        "estado": 1,
        "hdn_imovel": 1,
        "id": 1,
        "imagens": 1,
        "modo_venda": 1,
        "preco_aluguel": 1,
        "preco_avaliacao": 1,
        "preco_venda": 1,
        "quartos": 1,
        "suites": 1,
        "tipo_imovel": 1,
        "url": 1,
        "vagas": 1,
    }


def document_to_property(doc, criteria):
    if doc.get("ativo") is False:
        return None

    source_id = str(doc.get("hdn_imovel") or doc.get("id") or doc.get("_id"))
    if not source_id:
        return None

    transaction = criteria.get("transaction", "SALE")
    sale_price = first_money(doc, "preco_venda", "preco_avaliacao")
    rental_price = first_money(doc, "preco_aluguel")
    if transaction == "RENT" and rental_price is None:
        rental_price = sale_price
        sale_price = None
    elif transaction != "RENT":
        rental_price = None

    images = normalize_images(doc.get("imagens"))
    city = clean_text(doc.get("cidade"))
    neighborhood = clean_text(doc.get("bairro"))
    property_type = normalize_property_type(doc.get("tipo_imovel"))
    title = clean_text(doc.get("titulo")) or build_title(property_type, neighborhood, city)
    url = clean_text(doc.get("url")) or f"mongo://imoveis/{source_id}"

    return {
        "source": "MONGO",
        "source_id": source_id,
        "title": title,
        "advertiser_name": "Banco interno",
        "description": clean_text(doc.get("descricao")),
        "sale_price": sale_price,
        "rental_price": rental_price,
        "city": city,
        "state": clean_text(doc.get("estado")),
        "neighborhood": neighborhood,
        "street": clean_text(doc.get("endereco")),
        "bedrooms": first_number(doc, "quartos", "dormitorios"),
        "bathrooms": first_number(doc, "banheiros"),
        "suites": first_number(doc, "suites"),
        "parking_spaces": first_number(doc, "vagas", "garagens"),
        "usable_area": first_number(doc, "area_util", "area_construida"),
        "total_area": first_number(doc, "area_total"),
        "condominium_fee": first_money(doc, "condominio", "valor_condominio"),
        "iptu": first_money(doc, "iptu"),
        "property_type": property_type,
        "image_url": images[0] if images else None,
        "image_urls": images,
        "url": url,
        "country": "BR",
        "date_posted": normalize_date(doc.get("data_publicacao")),
    }


def first_number(doc, *keys):
    for key in keys:
        value = item_number(doc.get(key))
        if value is not None:
            return value
    return None


def first_money(doc, *keys):
    for key in keys:
        value = item_money(doc.get(key))
        if value is not None:
            return value
    return None


def normalize_images(value):
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        images = []
        for item in value:
            if isinstance(item, str):
                images.append(item)
            elif isinstance(item, dict):
                url = item.get("url") or item.get("src")
                if url:
                    images.append(str(url))
        return images
    return []


def normalize_property_type(value):
    raw = clean_text(value)
    if not raw:
        return "OTHER"

    text = raw.lower()
    if "apart" in text:
        return "APARTMENT"
    if "casa" in text or "sobrado" in text:
        return "HOUSE"
    if "cobertura" in text:
        return "PENTHOUSE"
    if "sala" in text:
        return "COMMERCIAL_ROOM"
    if "comercial" in text or "loja" in text:
        return "COMMERCIAL"
    return "OTHER"


def build_title(property_type, neighborhood, city):
    label = {
        "APARTMENT": "Apartamento",
        "HOUSE": "Casa",
        "PENTHOUSE": "Cobertura",
        "COMMERCIAL_ROOM": "Sala comercial",
        "COMMERCIAL": "Imóvel comercial",
    }.get(property_type, "Imóvel")
    location = ", ".join(value for value in (neighborhood, city) if value)
    return f"{label} em {location}" if location else label


def normalize_date(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value
