/**
 * sfy (Climabrisa): formulário público hospedado pelo CRM.
 *
 * Mostra, em uma página com endereço próprio (`/f/<token>`), as perguntas que a
 * fonte de webhook já guarda em `form_fields`. O envio é um POST comum para a
 * rota que já existe (`/api/v1/webhooks/in/<token>`): cria o contato e o
 * negócio no funil e na etapa da fonte, grava as respostas nos campos
 * personalizados e, se a fonte tiver `redirect_to`, volta para a página de
 * agradecimento. Nada de lógica nova de captação: só a vitrine.
 *
 * O token é o mesmo que já protege o formulário embutido em outros sites; o
 * endereço de envio sempre foi público.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { webhookFormFieldsSchema, type WebhookFormField } from "@/lib/webhooks/formulario";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

const campo =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:border-neutral-900 focus:outline-none";

function Pergunta({ field, t }: { field: WebhookFormField; t: (texto: string) => string }) {
  const id = `f-${field.key}`;
  const rotulo = (
    <>
      {field.label}
      {field.required ? <span aria-hidden> *</span> : null}
    </>
  );
  if (field.type === "checkbox") {
    return (
      <div className="flex items-start gap-2">
        <input type="hidden" name={field.key} value="false" />
        <input id={id} type="checkbox" name={field.key} value="true" required={field.required} className="mt-1" />
        <label htmlFor={id} className="text-sm text-neutral-800">
          {rotulo}
        </label>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800">
        {rotulo}
      </label>
      {field.type === "textarea" ? (
        <textarea id={id} name={field.key} rows={4} required={field.required} className={campo} />
      ) : field.type === "select" ? (
        <select id={id} name={field.key} required={field.required} defaultValue="" className={campo}>
          <option value="">{t("Selecione")}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field.key}
          type="text"
          inputMode={field.type === "number" || field.type === "currency" ? "decimal" : undefined}
          required={field.required}
          className={campo}
        />
      )}
    </div>
  );
}

export default async function FormularioPublico({ params }: Props) {
  const { token } = await params;
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);
  const admin = createAdminClient();
  const { data: fonte } = await admin
    .from("webhook_sources")
    .select("name, organization_id, form_fields, is_active")
    .eq("path_token", token)
    .maybeSingle();
  if (!fonte || !fonte.is_active) notFound();

  const campos = webhookFormFieldsSchema.safeParse(fonte.form_fields ?? []);
  const perguntas = campos.success ? campos.data : [];

  const { data: org } = await admin
    .from("organizations")
    .select("display_name")
    .eq("id", fonte.organization_id as string)
    .maybeSingle();
  const empresa = (org?.display_name as string | undefined) ?? "";

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow-sm sm:p-8">
        {empresa ? <p className="text-sm font-medium text-neutral-500">{empresa}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{fonte.name as string}</h1>
        <form action={`/api/v1/webhooks/in/${token}`} method="POST" className="mt-6 space-y-4">
          <div>
            <label htmlFor="f-nome" className="block text-sm font-medium text-neutral-800">
              {t("Nome completo")} <span aria-hidden>*</span>
            </label>
            <input id="f-nome" name="nome" type="text" required autoComplete="name" className={campo} />
          </div>
          <div>
            <label htmlFor="f-telefone" className="block text-sm font-medium text-neutral-800">
              {t("WhatsApp com DDD")} <span aria-hidden>*</span>
            </label>
            <input id="f-telefone" name="telefone" type="tel" required autoComplete="tel" className={campo} />
          </div>
          <div>
            <label htmlFor="f-email" className="block text-sm font-medium text-neutral-800">
              {t("E-mail")}
            </label>
            <input id="f-email" name="email" type="email" autoComplete="email" className={campo} />
          </div>
          {perguntas.map((p) => (
            <Pergunta key={p.key} field={p} t={t} />
          ))}
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-4 py-3 text-base font-medium text-white hover:bg-neutral-700"
          >
            {t("Enviar")}
          </button>
        </form>
      </div>
    </main>
  );
}
