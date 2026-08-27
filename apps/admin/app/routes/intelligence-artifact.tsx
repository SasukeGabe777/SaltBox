import { loadIntelligenceArtifact } from "../data/intelligence-artifacts.server";
import type { Route } from "./+types/intelligence-artifact";

export async function loader({ params }: Route.LoaderArgs) {
  return loadIntelligenceArtifact(params.ref, params.file);
}
