import { cn } from "@/lib/utils";

// StickPeel official mark: circular peeled sticker
export function Logomark({ className }: { className?: string }) {
  return (
    <img
      src="/official_logo.png"
      alt="StickPeel"
      className={cn("size-8 object-contain shrink-0", className)}
    />
  );
}

// StickPeel lockup: official circular logo mark + single-color blue wordmark
export function Logo({
  className,
  markClassName,
  textClassName,
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 select-none h-8",
        className
      )}
      role="img"
      aria-label="StickPeel"
    >
      <img
        src="/official_logo.png"
        alt=""
        className={cn(
          "h-full w-auto aspect-square object-contain shrink-0 drop-shadow-xs",
          markClassName
        )}
      />
      <span
        className={cn(
          "font-bold tracking-tight text-sky-600 dark:text-sky-400 text-lg leading-none",
          textClassName
        )}
      >
        StickPeel
      </span>
    </div>
  );
}

