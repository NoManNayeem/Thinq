import { toast } from "sonner";
import { errorMessage } from "@/lib/api/client";

/**
 * Confirm a change and offer to reverse it. The toast stays long enough to read
 * and act on, which matters on slow devices.
 */
export function toastWithUndo({
  message,
  description,
  undo,
  undoneMessage,
}: {
  message: string;
  description?: string;
  undo: () => Promise<unknown>;
  undoneMessage: string;
}) {
  toast.success(message, {
    description,
    duration: 10_000,
    action: {
      label: "Undo",
      onClick: () => {
        toast.promise(undo(), {
          loading: "Undoing…",
          success: undoneMessage,
          error: (e: unknown) => errorMessage(e),
        });
      },
    },
  });
}
