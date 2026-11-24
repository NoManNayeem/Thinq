import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { SignInForm } from "./sign-in-form";

describe("SignInForm", () => {
  it("validates before submitting", async () => {
    const onSubmit = vi.fn();
    render(<SignInForm onSubmit={onSubmit} pending={false} error={null} />);
    await userEvent.type(screen.getByLabelText("Work email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits trimmed credentials", async () => {
    const onSubmit = vi.fn();
    render(<SignInForm onSubmit={onSubmit} pending={false} error={null} />);
    await userEvent.type(screen.getByLabelText("Work email"), "  nora@example.com ");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith(
      { email: "nora@example.com", password: "secret" },
      expect.anything(),
    );
  });

  it("shows the server's error message", () => {
    const error = new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
    render(<SignInForm onSubmit={vi.fn()} pending={false} error={error} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("disables the button while signing in", () => {
    render(<SignInForm onSubmit={vi.fn()} pending error={null} />);
    expect(screen.getByRole("button", { name: /Signing in/ })).toBeDisabled();
  });
});
