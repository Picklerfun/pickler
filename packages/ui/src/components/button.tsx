import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const buttonVariants = cva(
  "tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:gap-2 tw:rounded-md tw:text-sm tw:font-medium tw:whitespace-nowrap tw:transition-all tw:outline-none tw:focus-visible:border-ring tw:focus-visible:ring-[3px] tw:focus-visible:ring-ring tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:aria-invalid:border-destructive tw:aria-invalid:ring-destructive tw:dark:aria-invalid:ring-destructive tw:[&_svg]:pointer-events-none tw:[&_svg]:shrink-0 tw:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "tw:bg-primary tw:text-primary-foreground tw:hover:bg-primary/90",
        destructive:
          "tw:bg-destructive-surface tw:text-destructive-foreground tw:hover:bg-destructive-surface tw:focus-visible:ring-destructive tw:dark:bg-destructive-surface tw:dark:focus-visible:ring-destructive",
        outline:
          "tw:border tw:bg-background tw:shadow-xs tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:border-input tw:dark:bg-muted tw:dark:hover:bg-accent",
        secondary: "tw:bg-secondary tw:text-secondary-foreground tw:hover:bg-secondary/80",
        ghost: "tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:hover:bg-accent",
        link: "tw:text-primary tw:underline-offset-4 tw:hover:underline",
      },
      size: {
        default: "tw:h-9 tw:px-4 tw:py-2 tw:has-[>svg]:px-3",
        xs: "tw:h-6 tw:gap-1 tw:rounded-md tw:px-2 tw:text-xs tw:has-[>svg]:px-1.5 tw:[&_svg:not([class*=size-])]:size-3",
        sm: "tw:h-8 tw:gap-1.5 tw:rounded-md tw:px-3 tw:has-[>svg]:px-2.5",
        lg: "tw:h-10 tw:rounded-md tw:px-6 tw:has-[>svg]:px-4",
        icon: "tw:size-9",
        "icon-xs": "tw:size-6 tw:rounded-md tw:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "tw:size-8",
        "icon-lg": "tw:size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
