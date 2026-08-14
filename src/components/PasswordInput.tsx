import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  showToggleLabel?: { show: string; hide: string };
};

export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className, showToggleLabel, ...rest },
  ref,
) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={shown ? "text" : "password"}
        className={cn("pr-10", className)}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={shown ? showToggleLabel?.hide ?? "Hide password" : showToggleLabel?.show ?? "Show password"}
        onClick={() => setShown((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground transition"
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
