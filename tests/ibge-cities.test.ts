import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearMunicipalityCacheForTests,
  findMunicipality,
  searchMunicipalities,
} from "@/lib/ibge-cities";

afterEach(() => {
  clearMunicipalityCacheForTests();
  vi.unstubAllGlobals();
});

describe("municípios do IBGE", () => {
  it("busca sem exigir acentos e prioriza nomes que começam pelo texto", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: 1, nome: "Esmeraldas" },
      { id: 2, nome: "São José da Lapa" },
      { id: 3, nome: "José Gonçalves de Minas" },
    ])));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchMunicipalities("MG", "sao jose")).resolves.toEqual([
      { id: 2, name: "São José da Lapa" },
    ]);
    await expect(findMunicipality("MG", "ESMERALDAS")).resolves.toEqual({
      id: 1,
      name: "Esmeraldas",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não consulta o IBGE para uma UF inexistente", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchMunicipalities("XX", "cidade")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
