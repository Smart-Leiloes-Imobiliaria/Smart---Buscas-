"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BRAZILIAN_STATES } from "@/lib/brazilian-states";
import { api } from "@/lib/client-api";
import type { CollectorPropertyFilters } from "@/lib/schemas";

export function SearchForm({
  defaults,
  error,
}: {
  defaults: CollectorPropertyFilters;
  error?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [state, setState] = useState(defaults.state ?? "");
  const [city, setCity] = useState(defaults.city ?? "");
  const [citySelected, setCitySelected] = useState(
    Boolean(defaults.state && defaults.city),
  );
  const [cityFocused, setCityFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{ id: number; name: string }>
  >([]);

  useEffect(() => {
    if (!state || citySelected || city.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await api<{
          cities: Array<{ id: number; name: string }>;
        }>(
          `/api/locations/cities?state=${encodeURIComponent(state)}&q=${encodeURIComponent(city)}`,
          { signal: controller.signal },
        );
        setSuggestions(response.cities);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Não foi possível consultar as cidades",
          );
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [city, citySelected, state]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!citySelected) {
      setSubmitError("Selecione uma cidade na lista de sugestões.");
      return;
    }
    setBusy(true);
    setSubmitError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const optionalNumber = (value: FormDataEntryValue | undefined) =>
      value == null || value === "" ? undefined : Number(value);
    try {
      const response = await api<{ searchId: string }>(
        "/api/property-searches",
        {
          method: "POST",
          body: JSON.stringify({
            city: values.city,
            state: values.state,
            neighborhood: values.neighborhood || undefined,
            transaction: values.transaction,
            propertyType: values.propertyType || undefined,
            minPrice: optionalNumber(values.minPrice),
            maxPrice: optionalNumber(values.maxPrice),
            minArea: optionalNumber(values.minArea),
            maxArea: optionalNumber(values.maxArea),
            bedrooms: optionalNumber(values.bedrooms),
          }),
        },
      );
      router.push(`/property-searches/${response.searchId}`);
    } catch (caught) {
      setSubmitError(
        caught instanceof Error ? caught.message : "Não foi possível pesquisar",
      );
      setBusy(false);
    }
  }

  return (
    <form className="search-panel" onSubmit={submit}>
      <div className="field city-field">
        <label htmlFor="city">Cidade</label>
        <input
          id="city"
          name="city"
          value={city}
          placeholder={state ? "Comece a digitar" : "Selecione o estado"}
          required
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="city-suggestions"
          aria-expanded={cityFocused && suggestions.length > 0}
          disabled={!state}
          onFocus={() => setCityFocused(true)}
          onBlur={() => window.setTimeout(() => setCityFocused(false), 150)}
          onChange={(event) => {
            setCity(event.target.value);
            setCitySelected(false);
            setSubmitError("");
          }}
        />
        {cityFocused && suggestions.length > 0 && (
          <div className="city-suggestions" id="city-suggestions" role="listbox">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                role="option"
                aria-selected={citySelected && city === suggestion.name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setCity(suggestion.name);
                  setCitySelected(true);
                  setSuggestions([]);
                  setCityFocused(false);
                  setSubmitError("");
                }}
              >
                {suggestion.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="state">Estado</label>
        <select
          id="state"
          name="state"
          value={state}
          required
          onChange={(event) => {
            setState(event.target.value);
            setCity("");
            setCitySelected(false);
            setSuggestions([]);
            setSubmitError("");
          }}
        >
          <option value="">Selecione</option>
          {BRAZILIAN_STATES.map((stateCode) => (
            <option value={stateCode} key={stateCode}>{stateCode}</option>
          ))}
        </select>
      </div>
      <div className="field"><label htmlFor="neighborhood">Bairro</label><input id="neighborhood" name="neighborhood" defaultValue={defaults.neighborhood} placeholder="Opcional" /></div>
      <div className="field"><label htmlFor="transaction">Negócio</label><select id="transaction" name="transaction" defaultValue={defaults.transaction}><option value="SALE">Comprar</option><option value="RENT">Alugar</option></select></div>
      <div className="field"><label htmlFor="propertyType">Tipo</label><select id="propertyType" name="propertyType" defaultValue={defaults.propertyType ?? ""}><option value="">Todos</option><option value="APARTMENT">Apartamento</option><option value="HOUSE">Casa</option><option value="PENTHOUSE">Cobertura</option><option value="COMMERCIAL_ROOM">Sala comercial</option><option value="COMMERCIAL">Imóvel comercial</option></select></div>
      <div className="field"><label htmlFor="minPrice">Preço mínimo</label><input id="minPrice" name="minPrice" type="number" min="0" defaultValue={defaults.minPrice} placeholder="500000" /></div>
      <div className="field"><label htmlFor="maxPrice">Preço máximo</label><input id="maxPrice" name="maxPrice" type="number" min="0" defaultValue={defaults.maxPrice} placeholder="900000" /></div>
      <div className="field"><label htmlFor="minArea">Área mínima (m²)</label><input id="minArea" name="minArea" type="number" min="1" defaultValue={defaults.minArea} placeholder="60" /></div>
      <div className="field"><label htmlFor="maxArea">Área máxima (m²)</label><input id="maxArea" name="maxArea" type="number" min="1" defaultValue={defaults.maxArea} placeholder="250" /></div>
      <div className="field"><label htmlFor="bedrooms">Quartos</label><select id="bedrooms" name="bedrooms" defaultValue={defaults.bedrooms ?? ""}><option value="">Todos</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select></div>
      <button className="primary" type="submit" disabled={busy}>{busy ? "Iniciando busca…" : "Buscar imóveis"}</button>
      {(error || submitError) && <p className="form-error" role="alert">{submitError || error}</p>}
    </form>
  );
}
