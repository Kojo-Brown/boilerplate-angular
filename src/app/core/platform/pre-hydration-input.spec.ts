import { typedBeforeHydration } from './pre-hydration-input';

/**
 * The markup a prerendered form arrives as. Angular writes attribute names lowercased —
 * `formcontrolname` — which is the detail the selector in `typedBeforeHydration` has to
 * survive, so the fixture spells it the way the server does rather than the way the
 * template does.
 */
function serverRenderedForm(values: Record<string, string>): HTMLElement {
  const host = document.createElement('app-login-form');
  const form = document.createElement('form');
  for (const [control, value] of Object.entries(values)) {
    const input = document.createElement('input');
    input.setAttribute('formcontrolname', control);
    input.value = value;
    form.append(input);
  }
  host.append(form);
  return host;
}

describe('typedBeforeHydration', () => {
  it('reads what is in the server-rendered inputs', () => {
    const host = serverRenderedForm({ email: 'typed@example.com', password: 'Password1' });

    expect(typedBeforeHydration(host, ['email', 'password'] as const)).toEqual({
      email: 'typed@example.com',
      password: 'Password1',
    });
  });

  it('omits a field the visitor did not type into, so the caller’s default is reached', () => {
    const host = serverRenderedForm({ email: 'typed@example.com', password: '' });

    const typed = typedBeforeHydration(host, ['email', 'password'] as const);

    expect(typed.password).toBeUndefined();
    expect(typed.password ?? '').toBe('');
  });

  it('omits a control the markup does not have', () => {
    const host = serverRenderedForm({ email: 'typed@example.com' });

    expect(typedBeforeHydration(host, ['email', 'password'] as const)).toEqual({
      email: 'typed@example.com',
    });
  });

  /**
   * The client-rendered case, which is every unit test and every in-app navigation: the
   * component's host exists but its template has not been created yet, so there is
   * nothing to recover and nothing to go wrong.
   */
  it('returns nothing for a host with no rendered form', () => {
    expect(
      typedBeforeHydration(document.createElement('app-login-form'), ['email'] as const)
    ).toEqual({});
  });

  it('does not reach into a nested form belonging to something else', () => {
    const host = serverRenderedForm({ email: 'typed@example.com' });
    const sibling = serverRenderedForm({ email: 'someone-else@example.com' });

    expect(typedBeforeHydration(host, ['email'] as const).email).toBe('typed@example.com');
    expect(typedBeforeHydration(sibling, ['email'] as const).email).toBe(
      'someone-else@example.com'
    );
  });
});
