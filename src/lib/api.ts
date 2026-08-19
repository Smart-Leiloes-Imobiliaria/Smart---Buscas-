import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { detail: error.issues[0]?.message ?? "Dados inválidos" },
      { status: 422 },
    );
  }
  console.error(error);
  return NextResponse.json(
    { detail: "Não foi possível concluir a operação" },
    { status: 500 },
  );
}
