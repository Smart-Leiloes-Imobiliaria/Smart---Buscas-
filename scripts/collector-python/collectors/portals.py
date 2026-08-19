from urllib.parse import quote, urlencode

from collectors.vivareal import VivaRealCollector, clean_text, slugify


TYPE_PATHS = {
    "APARTMENT": "apartamentos",
    "HOUSE": "casas",
    "PENTHOUSE": "coberturas",
    "COMMERCIAL_ROOM": "salas-comerciais",
    "COMMERCIAL": "imoveis-comerciais",
}


def required_location(criteria):
    city = clean_text(criteria.get("city"))
    state = clean_text(criteria.get("state"))
    if not city or not state:
        raise ValueError("Cidade e estado são obrigatórios para pesquisar.")
    return city, state.upper()


def common_query(criteria):
    query = {}
    mappings = {
        "minPrice": "precoMinimo",
        "maxPrice": "precoMaximo",
        "minArea": "areaMinima",
        "maxArea": "areaMaxima",
    }
    for source_key, target_key in mappings.items():
        value = criteria.get(source_key)
        if value is not None:
            query[target_key] = value
    return query


class ZapCollector(VivaRealCollector):
    source = "ZAP"
    name = "ZAP Imóveis"

    def build_search_url(self, criteria):
        city, state = required_location(criteria)
        action = "aluguel" if criteria.get("transaction") == "RENT" else "venda"
        property_path = TYPE_PATHS.get(
            str(criteria.get("propertyType") or "").upper(),
            "imoveis",
        )
        location_parts = [state.lower(), slugify(city)]
        neighborhood = clean_text(criteria.get("neighborhood"))
        if neighborhood:
            location_parts.append(slugify(neighborhood))
        location = quote("+".join(location_parts), safe="")
        query = common_query(criteria)
        url = f"https://www.zapimoveis.com.br/{action}/{property_path}/{location}/"
        return f"{url}?{urlencode(query)}" if query else url


class ImovelwebCollector(VivaRealCollector):
    source = "IMOVELWEB"
    name = "Imovelweb"

    def build_search_url(self, criteria):
        city, state = required_location(criteria)
        action = "aluguel" if criteria.get("transaction") == "RENT" else "venda"
        property_path = TYPE_PATHS.get(
            str(criteria.get("propertyType") or "").upper(),
            "imoveis",
        )
        location = "-".join(
            filter(
                None,
                [
                    slugify(criteria.get("neighborhood")),
                    slugify(city),
                    state.lower(),
                ],
            )
        )
        return f"https://www.imovelweb.com.br/{property_path}-{action}-{location}.html"


class CasaMineiraCollector(VivaRealCollector):
    source = "CASAMINEIRA"
    name = "Casa Mineira"

    def build_search_url(self, criteria):
        city, state = required_location(criteria)
        action = "aluguel" if criteria.get("transaction") == "RENT" else "venda"
        return (
            f"https://www.casamineira.com.br/{action}/imovel/"
            f"{slugify(city)}_{state.lower()}"
        )


class QuintoAndarCollector(VivaRealCollector):
    source = "QUINTOANDAR"
    name = "QuintoAndar"

    def build_search_url(self, criteria):
        city, state = required_location(criteria)
        action = "alugar" if criteria.get("transaction") == "RENT" else "comprar"
        location = "-".join(
            filter(
                None,
                [
                    slugify(criteria.get("neighborhood")),
                    slugify(city),
                    state.lower(),
                    "brasil",
                ],
            )
        )
        type_path = {
            "APARTMENT": "apartamento",
            "HOUSE": "casa",
            "PENTHOUSE": "cobertura",
            "COMMERCIAL_ROOM": "sala-comercial",
            "COMMERCIAL": "imovel-comercial",
        }.get(str(criteria.get("propertyType") or "").upper())
        suffix = f"/{type_path}" if type_path else ""
        return f"https://www.quintoandar.com.br/{action}/imovel/{location}{suffix}"


class OlxCollector(VivaRealCollector):
    source = "OLX"
    name = "OLX Imóveis"

    def build_search_url(self, criteria):
        city, state = required_location(criteria)
        action = "aluguel" if criteria.get("transaction") == "RENT" else "venda"
        property_path = TYPE_PATHS.get(
            str(criteria.get("propertyType") or "").upper()
        )
        type_segment = f"/{property_path}" if property_path else ""
        return (
            f"https://www.olx.com.br/imoveis/{action}{type_segment}/"
            f"estado-{state.lower()}/{slugify(city)}-e-regiao"
        )
