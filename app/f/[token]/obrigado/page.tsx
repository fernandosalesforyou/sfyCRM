/** sfy (Climabrisa): agradecimento do formulário público. Sem dado de ninguém aqui. */
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Obrigado() {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="mx-auto max-w-xl rounded-xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Recebemos o seu cadastro</h1>
        <p className="mt-3 text-neutral-700">Obrigado! A nossa equipe analisará as informações e entrará em contato.</p>
      </div>
    </main>
  );
}
