import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // BlockFrame label pill: pastel fill, black border, uppercase Space Grotesk.
  "label-chrome inline-flex items-center justify-center rounded-full border-2 border-black px-2.5 py-0.5 text-[11px] leading-tight text-black w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:ring-[3px] focus-visible:ring-black/30 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary [a&]:hover:bg-white",
        secondary: "bg-white [a&]:hover:bg-accent",
        destructive: "bg-destructive",
        outline: "bg-white [a&]:hover:bg-accent",
        success: "bg-success",
        info: "bg-info",
        warning: "bg-warning",
        pink: "bg-pastel-pink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
