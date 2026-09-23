import { test, expect } from '@playwright/test';
import { mockInviteCheck, mockRegisterSuccess, mockRegisterFailure } from './helpers/api-mocks';

test.describe('Form validation — Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('shows validation errors on empty submit', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  });

  test('shows invalid email error', async ({ page }) => {
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByLabel('Email address').blur();

    await expect(page.getByText('Please enter a valid email address')).toBeVisible();
  });

  test('shows password too short error', async ({ page }) => {
    await page.getByLabel('Password').fill('short');
    await page.getByLabel('Password').blur();

    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  });

  test('clears validation errors when valid input is entered', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email is required')).toBeVisible();

    await page.getByLabel('Email address').fill('valid@example.com');
    await page.getByLabel('Email address').blur();

    await expect(page.getByText('Email is required')).not.toBeVisible();
    await expect(page.getByText('Please enter a valid email address')).not.toBeVisible();
  });

  test('does not submit when form is invalid', async ({ page }) => {
    let requestMade = false;
    await page.route('**/auth/login', () => {
      requestMade = true;
    });

    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Email is required')).toBeVisible();
    expect(requestMade).toBe(false);
  });
});

test.describe('Form validation — Register', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('shows all validation errors on empty submit', async ({ page }) => {
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Name must be at least 2 characters')).toBeVisible();
    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  });

  test('shows invalid email error on register form', async ({ page }) => {
    await page.getByLabel('Email address').fill('invalid');
    await page.getByLabel('Email address').blur();

    await expect(page.getByText('Please enter a valid email address')).toBeVisible();
  });

  test('shows password strength requirements error', async ({ page }) => {
    await page.getByLabel('Password').fill('alllowercase1');
    await page.getByLabel('Password').blur();

    await expect(
      page.getByText('Password must contain at least one uppercase letter')
    ).toBeVisible();
  });

  test('shows password missing number error', async ({ page }) => {
    await page.getByLabel('Password').fill('AllLowercase');
    await page.getByLabel('Password').blur();

    await expect(page.getByText('Password must contain at least one number')).toBeVisible();
  });

  test('shows passwords do not match error', async ({ page }) => {
    await page.getByLabel('Full name').fill('Jane Smith');
    await page.getByLabel('Email address').fill('jane@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByLabel('Confirm password').fill('DifferentPass1');

    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText("Passwords don't match")).toBeVisible();
  });

  test('successful registration redirects to dashboard', async ({ page }) => {
    await mockRegisterSuccess(page);

    await page.getByLabel('Full name').fill('Jane Smith');
    await page.getByLabel('Email address').fill('jane@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByLabel('Confirm password').fill('Password1');

    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/dashboard');
  });

  test('API error on register is displayed', async ({ page }) => {
    await mockRegisterFailure(page, 'Email already in use');

    await page.getByLabel('Full name').fill('Jane Smith');
    await page.getByLabel('Email address').fill('existing@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByLabel('Confirm password').fill('Password1');

    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('alert')).toContainText('Email already in use');
  });

  test('name too short error', async ({ page }) => {
    await page.getByLabel('Full name').fill('J');
    await page.getByLabel('Full name').blur();

    await expect(page.getByText('Name must be at least 2 characters')).toBeVisible();
  });

  test('an invite code is checked against the email, once', async ({ page }) => {
    const invite = await mockInviteCheck(page, 'That code was issued to another address');

    await page.getByLabel('Email address').fill('jane@example.com');
    await page.getByLabel('Workspace invite code').pressSequentially('WS-0000-0001', { delay: 30 });

    await expect(page.getByText('That code was issued to another address')).toBeVisible();
    // Twelve keystrokes, one request: the debounce, not the assertion above, is the
    // thing under test.
    expect(invite.calls()).toBe(1);
  });

  test('correcting the email re-checks a code the user has not touched', async ({ page }) => {
    const invite = await mockInviteCheck(page, 'That code was issued to another address');

    await page.getByLabel('Email address').fill('jane@example.com');
    await page.getByLabel('Workspace invite code').fill('WS-0000-0001');
    await expect(page.getByText('That code was issued to another address')).toBeVisible();

    const corrected = await mockInviteCheck(page, null);

    await page.getByLabel('Email address').fill('jane@other.example');

    // Waiting for the *settled* state and not just for the error to clear: the error
    // clears the moment the control goes PENDING, which is before the debounce has even
    // elapsed, so asserting on its absence alone would pass without a request.
    await expect(page.getByText('Leave blank to create a personal workspace')).toBeVisible();
    await expect(page.getByText('That code was issued to another address')).not.toBeVisible();

    // The code was never touched; the email alone re-asked the question.
    expect(invite.calls()).toBe(1);
    expect(corrected.calls()).toBe(1);
  });

  test('link to login page is present and navigates', async ({ page }) => {
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/login');
  });
});
