import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // BlockFrame button: black border + hard shadow that presses flat on click.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border-2 border-black text-[13px] font-extrabold uppercase tracking-wide transition-[transform,box-shadow,background-color] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-black/30 aria-invalid:border-destructive [&[role=combobox]]:normal-case [&[role=combobox]]:tracking-normal [&[role=combobox]]:font-medium",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-hard-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-[5px_5px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        destructive:
          "bg-destructive text-black shadow-hard-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-[5px_5px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        success:
          "bg-success text-black shadow-hard-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-[5px_5px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        outline:
          "bg-white text-black shadow-hard-sm hover:bg-accent active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        secondary:
          "bg-accent text-accent-foreground shadow-hard-sm hover:bg-white active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
        ghost:
          "border-transparent hover:border-black hover:bg-white",
        link: "border-transparent normal-case tracking-normal underline decoration-2 underline-offset-4 hover:bg-primary",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-12 px-6 text-sm has-[>svg]:px-4",
        icon: "size-10",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
