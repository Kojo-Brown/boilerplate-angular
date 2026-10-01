import { buildContentSecurityPolicy, TRUSTED_TYPES_POLICIES } from './csp';
import type { ContentSecurityPolicyOptions } from './csp';

/**
 * The policy, asserted as a set of decisions rather than as a string.
 *
 * Comparing the whole header against a golden value would fail on every reordering and
 * tell a reader nothing about which property broke, so each spec below names one thing
 * the policy has to be true of. The two groups that matter most are the *omissions* —
 * a directive is only as strong as what it leaves out, and nothing in a build fails when
 * `'unsafe-inline'` creeps back in — and the *derivations*, which are the ones a
 * hardcoded policy would get wrong the moment someone configured a CDN.
 */
describe('buildContentSecurityPolicy', () => {
  const NONCE = 'r4nd0mNonceValue==';

  /** The checked-in production environment: same-origin API, no CDN, no collector. */
  const production: ContentSecurityPolicyOptions = {
    nonce: NONCE,
    apiUrl: '/api/v1',
    imageCdnUrl: '',
    vitalsUrl: '',
  };

  /** Every `name a b c` pair in a policy, as a map of directive to its source list. */
  function directives(policy: string): Map<string, readonly string[]> {
    return new Map(
      policy.split('; ').map((directive) => {
        const [name, ...values] = directive.split(' ');
        return [name, values];
      })
    );
  }

  function sourcesFor(options: ContentSecurityPolicyOptions, directive: string): readonly string[] {
    return directives(buildContentSecurityPolicy(options)).get(directive) ?? [];
  }

  describe('the nonce', () => {
    it('authorises script and style with this response’s nonce', () => {
      expect(sourcesFor(production, 'script-src')).toContain(`'nonce-${NONCE}'`);
      expect(sourcesFor(production, 'style-src')).toContain(`'nonce-${NONCE}'`);
    });

    // The nonce is the only part of the policy that may differ between two responses.
    // If anything else did, a cache would be wrong about more than freshness.
    it('is the only thing that changes between two calls', () => {
      const first = buildContentSecurityPolicy({ ...production, nonce: 'AAAA' });
      const second = buildContentSecurityPolicy({ ...production, nonce: 'BBBB' });

      expect(first.replaceAll('AAAA', 'N')).toBe(second.replaceAll('BBBB', 'N'));
    });
  });

  describe('what it refuses to allow', () => {
    // Each of these is a one-token edit that would silently make the policy ornamental,
    // and none of them fails a build, a typecheck or any other spec.
    it('never allows inline script', () => {
      expect(sourcesFor(production, 'script-src')).not.toContain("'unsafe-inline'");
    });

    it('never allows eval', () => {
      expect(sourcesFor(production, 'script-src')).not.toContain("'unsafe-eval'");
      // Including in development, where `apiUrl` is cross-origin. The dev server runs
      // under this policy unchanged; see the header of csp.ts.
      const development = { ...production, apiUrl: 'http://localhost:3000/api/v1' };
      expect(sourcesFor(development, 'script-src')).not.toContain("'unsafe-eval'");
    });

    it('never allows inline style through style-src itself', () => {
      // `style-src-attr` is where the concession lives, and only for attributes, which
      // cannot carry a nonce. `<style>` elements can and do.
      expect(sourcesFor(production, 'style-src')).not.toContain("'unsafe-inline'");
      expect(sourcesFor(production, 'style-src-attr')).toEqual(["'unsafe-inline'"]);
    });

    it('blocks plugins, framing, and base-tag injection', () => {
      expect(sourcesFor(production, 'object-src')).toEqual(["'none'"]);
      expect(sourcesFor(production, 'frame-ancestors')).toEqual(["'none'"]);
      expect(sourcesFor(production, 'frame-src')).toEqual(["'none'"]);
      expect(sourcesFor(production, 'base-uri')).toEqual(["'self'"]);
      expect(sourcesFor(production, 'form-action')).toEqual(["'self'"]);
    });

    // `'strict-dynamic'` would make a browser ignore `'self'`, which is what authorises
    // the lazy route chunks. See the comment on `script-src` in csp.ts.
    it('does not use strict-dynamic, which would strand the lazy route chunks', () => {
      expect(sourcesFor(production, 'script-src')).not.toContain("'strict-dynamic'");
    });

    // `data:` is the reflex addition here and nothing needs it. Asserted so that adding
    // it has to be a deliberate edit with a caller to point at.
    it('does not allow data: images', () => {
      expect(sourcesFor(production, 'img-src')).not.toContain('data:');
    });
  });

  describe('Trusted Types', () => {
    it('requires typed values at the dangerous DOM sinks', () => {
      expect(sourcesFor(production, 'require-trusted-types-for')).toEqual(["'script'"]);
    });

    it('allows the policies Angular and the CDK register for sanitised output', () => {
      expect(sourcesFor(production, 'trusted-types')).toEqual([...TRUSTED_TYPES_POLICIES]);
      expect(TRUSTED_TYPES_POLICIES).toContain('angular');
      expect(TRUSTED_TYPES_POLICIES).toContain('angular#components');
    });

    /**
     * The runtime half of the `bypassSecurityTrust*` ban.
     *
     * `@angular/core` registers `angular#unsafe-bypass` for those methods and nothing
     * else. Leaving it out of this list is what makes the browser refuse to create it,
     * which is what makes the bypass fail where no lint rule runs. It is asserted as an
     * omission because that is the shape of the mistake: adding one name to a list reads
     * like configuration and silently removes the enforcement.
     */
    it('refuses the bypass policy, so a bypass fails at the sink', () => {
      expect(sourcesFor(production, 'trusted-types')).not.toContain('angular#unsafe-bypass');
    });

    it('refuses the JIT policy, which an ahead-of-time build has no use for', () => {
      expect(sourcesFor(production, 'trusted-types')).not.toContain('angular#unsafe-jit');
    });
  });

  describe('what it derives from the environment', () => {
    // The whole reason this is a function. A hardcoded policy is correct for the
    // checked-in defaults and blocks every image the moment a CDN is configured —
    // with nothing failing at build time, because the default has no CDN.
    it('adds a configured image CDN to img-src', () => {
      const withCdn = { ...production, imageCdnUrl: 'https://cdn.example.com/images' };

      expect(sourcesFor(withCdn, 'img-src')).toEqual(["'self'", 'https://cdn.example.com']);
    });

    it('adds a configured web-vitals collector to connect-src', () => {
      const withBeacon = { ...production, vitalsUrl: 'https://vitals.example.com/collect' };

      expect(sourcesFor(withBeacon, 'connect-src')).toEqual([
        "'self'",
        'https://vitals.example.com',
      ]);
    });

    it('adds a cross-origin API to connect-src', () => {
      const development = { ...production, apiUrl: 'http://localhost:3000/api/v1' };

      expect(sourcesFor(development, 'connect-src')).toEqual(["'self'", 'http://localhost:3000']);
    });

    // A relative `apiUrl` is the production default and is not a URL. Contributing
    // nothing is the right answer — `'self'` already covers it — and the alternative is
    // a `null` or an `"undefined"` landing in the header as a source name.
    it('contributes nothing for a same-origin or unconfigured URL', () => {
      expect(sourcesFor(production, 'connect-src')).toEqual(["'self'"]);
      expect(sourcesFor(production, 'img-src')).toEqual(["'self'"]);
    });

    // Only the origin, never the path: a CSP source is an origin, and `'self'` plus
    // `https://cdn.example.com/images` would be a source expression that matches
    // nothing a browser fetches.
    it('reduces a configured URL to its origin, dropping the path', () => {
      const withCdn = { ...production, imageCdnUrl: 'https://cdn.example.com/a/b/c?x=1' };

      expect(sourcesFor(withCdn, 'img-src')).toContain('https://cdn.example.com');
      expect(buildContentSecurityPolicy(withCdn)).not.toContain('/a/b/c');
    });
  });

  describe('shape', () => {
    // Every directive is spelled out rather than inherited from `default-src`, so that
    // the header can be read during an incident without reconstructing the fallbacks.
    it('declares every directive it relies on', () => {
      const declared = [...directives(buildContentSecurityPolicy(production)).keys()];

      expect(declared).toEqual([
        'default-src',
        'script-src',
        'style-src',
        'style-src-attr',
        'img-src',
        'font-src',
        'connect-src',
        'object-src',
        'base-uri',
        'frame-ancestors',
        'frame-src',
        'form-action',
        'require-trusted-types-for',
        'trusted-types',
      ]);
    });

    it('never emits a directive with no sources', () => {
      for (const [name, values] of directives(buildContentSecurityPolicy(production))) {
        expect(values.length).withContext(`${name} has no sources`).toBeGreaterThan(0);
      }
    });
  });
});
