import type { Metadata } from "next";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { DeploymentError } from "../../lib/deployment.ts";
import { AssembleForm } from "./AssembleForm.tsx";
import { loadAssembleData, type AssembleData } from "./data.ts";

export const metadata: Metadata = { title: "Assemble a basket" };

export default async function AssemblePage() {
  let data: AssembleData | undefined;
  let problem: string | undefined;
  try {
    data = await loadAssembleData();
  } catch (e) {
    problem = e instanceof DeploymentError ? e.message : "Could not read the ComponentRegistry from Robinhood Chain right now.";
  }
  const nowSec = Math.floor(Date.now() / 1000);
  return (
    <>
      <h1>Assemble a basket</h1>
      <p className="muted">Pick 2 to 8 Stock Tokens, set weights, stake $WIF behind your thesis and publish. Five steps.</p>
      {data ? (
        <AssembleForm data={data} nowSec={nowSec} />
      ) : (
        <EmptyState title="Assemble is unavailable">{problem}</EmptyState>
      )}
    </>
  );
}
