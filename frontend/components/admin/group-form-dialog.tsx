"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SaveIcon, UsersRoundIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { IconInput } from "@/components/common/inputs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  description: z.string().trim().max(2000),
});
export type GroupFormValues = z.infer<typeof schema>;

export function GroupFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initial,
  nameLocked = false,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initial?: GroupFormValues;
  nameLocked?: boolean;
  pending: boolean;
  onSubmit: (values: GroupFormValues) => void;
}) {
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(schema),
    values: initial ?? { name: "", description: "" },
  });
  const { errors } = form.formState;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) form.reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form id="group-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="gap-6">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="gf-name">Name</FieldLabel>
              <IconInput
                icon={UsersRoundIcon}
                id="gf-name"
                disabled={nameLocked}
                placeholder="e.g. Field Operations"
                {...form.register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="gf-description">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Textarea id="gf-description" rows={3} {...form.register("description")} />
              <FieldDescription>Who belongs here, and what&apos;s shared with them.</FieldDescription>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="group-form" disabled={pending}>
            {pending ? <Spinner /> : <SaveIcon />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
