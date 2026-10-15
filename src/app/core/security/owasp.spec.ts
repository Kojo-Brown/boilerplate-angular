import { OWASP_EDITION, OWASP_TOP_10 } from './owasp';
import type { OwaspCategory, OwaspProof } from './owasp';

/**
 * The edition, transcribed by hand from the published list.
 *
 * This is the one duplication in the whole arrangement and it is deliberate. The ten
 * categories are an external fact: nothing in this repository can derive them, and
 * `assert-owasp-checklist.mjs` deliberately keeps no copy — a gate with its own list
 * would be a second place to drift and the one nobody would think to check. Here the
 * duplication buys something a single definition cannot: retitling a category, or
 * quietly dropping one and renumbering the rest, becomes a two-file diff a reviewer sees.
 *
 * Source: OWASP Top 10:2025, released at Global AppSec Washington DC, November 2025
 * (https://owasp.org/Top10/2025/). The 2021 edition is a different list — it has no
 * supply-chain or exceptional-conditions category and its A10 is SSRF, which 2025 folds
 * into A01 — so a checklist that still matched 2021 would be exactly the quiet kind of
 * wrong this file exists to catch.
 */
const EDITION_2025: readonly (readonly [string, string])[] = [
  ['A01', 'Broken Access Control'],
  ['A02', 'Security Misconfiguration'],
  ['A03', 'Software Supply Chain Failures'],
  ['A04', 'Cryptographic Failures'],
  ['A05', 'Injection'],
  ['A06', 'Insecure Design'],
  ['A07', 'Authentication Failures'],
  ['A08', 'Software or Data Integrity Failures'],
  ['A09', 'Logging & Alerting Failures'],
  ['A10', 'Mishandling of Exceptional Conditions'],
];

function proofKey(proof: OwaspProof): string {
  return proof.kind === 'gate'
    ? `gate:${proof.script}:${proof.command}`
    : `${proof.kind}:${proof.file}:${proof.test}`;
}

describe('the OWASP checklist', () => {
  it('names the edition it was written against', () => {
    expect(OWASP_EDITION).toBe('OWASP Top 10:2025');
  });

  it('covers the edition’s ten categories, in order, under their published titles', () => {
    expect(OWASP_TOP_10.map((category) => [category.id, category.title])).toEqual(
      EDITION_2025.map((entry) => [...entry])
    );
  });

  /**
   * A category with no mitigations is an honest answer for a risk a browser cannot touch,
   * and a dishonest one for anything else: `client-mitigated` or `shared-with-server`
   * asserts there is a defence here, and a defence with nothing behind it is the tick this
   * whole file exists to refuse.
   */
  it('backs every verdict that claims a client-side defence with at least one mitigation', () => {
    const empty = OWASP_TOP_10.filter(
      (category) => category.verdict !== 'server-owned' && category.mitigations.length === 0
    );

    expect(empty.map((category) => category.id)).toEqual([]);
  });

  /**
   * The converse, and the rule that keeps `server-owned` from becoming a shrug. A
   * category this application cannot close on its own has to leave an API author
   * something to implement from, or the checklist has recorded the risk and passed it
   * nowhere.
   */
  it('leaves a server contract wherever the client cannot close the category alone', () => {
    const unassigned = OWASP_TOP_10.filter(
      (category) => category.verdict !== 'client-mitigated' && category.serverContract === undefined
    );

    expect(unassigned.map((category) => category.id)).toEqual([]);
  });

  it('claims no server contract for a category it closes by itself', () => {
    const overclaimed = OWASP_TOP_10.filter(
      (category) => category.verdict === 'client-mitigated' && category.serverContract !== undefined
    );

    expect(overclaimed.map((category) => category.id)).toEqual([]);
  });

  describe('every mitigation', () => {
    const mitigations = OWASP_TOP_10.flatMap((category: OwaspCategory) =>
      category.mitigations.map((mitigation) => ({ category, mitigation }))
    );

    it('is proved by something, rather than asserted', () => {
      const unproven = mitigations.filter(({ mitigation }) => mitigation.proofs.length === 0);

      expect(unproven.map(({ mitigation }) => mitigation.id)).toEqual([]);
    });

    /**
     * Ids are what the `@owasp` markers in the gate scripts point at, so they have to be
     * unique and they have to say which category they belong to — a marker citing
     * `A01.something` from a rule that enforces an A05 claim is a mis-filing the gate
     * cannot otherwise see.
     */
    it('has an id that is unique and prefixed with its own category', () => {
      const ids = mitigations.map(({ mitigation }) => mitigation.id);
      const misfiled = mitigations
        .filter(({ category, mitigation }) => !mitigation.id.startsWith(`${category.id}.`))
        .map(({ mitigation }) => mitigation.id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(misfiled).toEqual([]);
    });

    /**
     * Every proof is resolved against the filesystem by
     * `scripts/ci/assert-owasp-checklist.mjs`, which is where a renamed spec or an
     * un-run suite is caught. What a spec can add is the shape: a `file` that is not a
     * spec file, or an `e2e` proof pointing into `src/`, would be resolved by the gate
     * against the wrong runner entirely.
     */
    it('cites proofs of a shape the gate can resolve', () => {
      const malformed = mitigations
        .flatMap(({ mitigation }) =>
          mitigation.proofs.map((proof) => ({ id: mitigation.id, proof }))
        )
        .filter(({ proof }) => {
          if (proof.kind === 'gate') {
            return !proof.script.startsWith('scripts/ci/') || proof.command.length === 0;
          }
          const root = proof.kind === 'spec' ? 'src/' : 'e2e/';
          return !proof.file.startsWith(root) || !proof.file.endsWith('.spec.ts');
        })
        .map(({ id }) => id);

      expect(malformed).toEqual([]);
    });

    /**
     * A duplicated proof is not wrong, but a *mitigation* that leans on nothing but
     * proofs another mitigation already leans on is usually two names for one claim. This
     * catches the case that matters: the same proof cited twice inside one mitigation,
     * which makes a one-proof claim look like a two-proof one.
     */
    it('does not pad a claim by citing the same proof twice', () => {
      const padded = mitigations
        .filter(({ mitigation }) => {
          const keys = mitigation.proofs.map(proofKey);
          return new Set(keys).size !== keys.length;
        })
        .map(({ mitigation }) => mitigation.id);

      expect(padded).toEqual([]);
    });

    it('states a claim specific enough to be disagreed with', () => {
      const vague = mitigations
        .filter(({ mitigation }) => mitigation.claim.trim().length < 40)
        .map(({ mitigation }) => mitigation.id);

      expect(vague).toEqual([]);
    });
  });

  /**
   * The gaps are the part of a checklist that makes it usable during an incident, and the
   * part that rots first: every category here either closes the risk or says what is
   * still open. `server-owned` and `shared-with-server` both mean something was handed
   * elsewhere, so both owe the reader a sentence about what.
   */
  it('records what is still open for every category it does not close by itself', () => {
    const silent = OWASP_TOP_10.filter(
      (category) =>
        category.verdict !== 'client-mitigated' &&
        (category.gaps === undefined || category.gaps.length === 0)
    );

    expect(silent.map((category) => category.id)).toEqual([]);
  });
});
