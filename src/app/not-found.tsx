import Link from "next/link";

export default function NotFound() {
  return <main className="content"><div className="empty"><h2>Página não encontrada</h2><p className="subtle">O endereço informado não existe.</p><Link className="primary" href="/">Voltar ao início</Link></div></main>;
}
