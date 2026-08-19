export function ErrorState({ message }: { message: string }) {
  return <div className="empty"><h3>Algo não saiu como esperado</h3><p>{message}</p></div>;
}
