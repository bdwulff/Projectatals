/** Curated, free commercial-use design references. No upstream template code or assets are embedded. */
export type DemoTemplateId = "fieldwork" | "momentum" | "folio";

export interface DemoTemplate {
  readonly id: DemoTemplateId;
  readonly name: string;
  readonly category: "trades" | "fitness" | "professional";
  readonly description: string;
  readonly implementation: "original_wulff_studio";
  readonly inspiration: {
    readonly name: string;
    readonly sourceUrl: string;
    readonly licence: "MIT";
    readonly licenceUrl: string;
    readonly verifiedAt: string;
    readonly copiedCode: false;
    readonly copiedAssets: false;
  };
  readonly attribution: string;
}

const source = (name: string, sourceUrl: string, licenceUrl: string) => Object.freeze({
  name, sourceUrl, licence: "MIT" as const, licenceUrl, verifiedAt: "2026-10-26", copiedCode: false as const, copiedAssets: false as const,
});

export const DEMO_TEMPLATES: readonly DemoTemplate[] = Object.freeze([
  Object.freeze({
    id: "fieldwork", name: "Fieldwork", category: "trades", implementation: "original_wulff_studio",
    description: "Warm paper, olive ink, architectural linework and a confident editorial service index.",
    inspiration: source("ScrewFast", "https://github.com/mearashadowfax/ScrewFast", "https://github.com/mearashadowfax/ScrewFast/blob/main/LICENSE"),
    attribution: "Original design and implementation by Wulff Studio. Free-template inspiration: ScrewFast (MIT); no upstream code or assets embedded.",
  }),
  Object.freeze({
    id: "momentum", name: "Momentum", category: "fitness", implementation: "original_wulff_studio",
    description: "Oversized athletic typography, warm black, ember red and original kinetic line art.",
    inspiration: source("Start Bootstrap Agency", "https://github.com/StartBootstrap/startbootstrap-agency", "https://github.com/StartBootstrap/startbootstrap-agency/blob/master/LICENSE"),
    attribution: "Original design and implementation by Wulff Studio. Free-template inspiration: Start Bootstrap Agency (MIT); no upstream code or assets embedded.",
  }),
  Object.freeze({
    id: "folio", name: "Folio", category: "professional", implementation: "original_wulff_studio",
    description: "Ivory and midnight blue, expansive serif typography and sculptural geometric illustration.",
    inspiration: source("Landwind", "https://github.com/themesberg/landwind", "https://github.com/themesberg/landwind/blob/main/LICENSE"),
    attribution: "Original design and implementation by Wulff Studio. Free-template inspiration: Landwind (MIT); no upstream code or assets embedded.",
  }),
]);

export function selectDemoTemplate(industry: string): DemoTemplate {
  const text = industry.toLocaleLowerCase("en-AU");
  const id: DemoTemplateId = /(?:gym|fitness|personal train|pilates|yoga|boxing|martial|wellness|sport|strength)/.test(text) ? "momentum"
    : /(?:fenc|plumb|electric|carpent|timber|build|roof|landscap|garden|trade|tyre|mechanic|automotive|concret|clean|paint|renovat|air.?con|floor)/.test(text) ? "fieldwork" : "folio";
  return getDemoTemplate(id);
}

export function getDemoTemplate(id: DemoTemplateId): DemoTemplate {
  const template = DEMO_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error("Unknown website demo template.");
  return template;
}
