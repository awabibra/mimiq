import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { GeneratedChain, ProjectChainEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

function isGeneratedChain(entry: ProjectChainEntry): entry is GeneratedChain {
  return "chain_data" in entry;
}

export default async function ChainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    notFound();
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: project, error } = await supabase
    .from("projects")
    .select("name, generated_chains")
    .contains("generated_chains", [{ id }])
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  const chains = (project.generated_chains ?? []) as ProjectChainEntry[];
  const chain = chains.filter(isGeneratedChain).find((entry) => entry.id === id);

  if (!chain) {
    notFound();
  }

  return (
    <main>
      <h1>{project.name}</h1>
      <p>{chain.chain_data.summary}</p>
      <ol>
        {chain.chain_data.chain.map((step) => (
          <li key={step.step}>
            <strong>{step.tool}</strong>: {step.action}
            <p>{step.reason}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
