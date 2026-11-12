import { cva } from "class-variance-authority";

const dynamic = "text-h1";

export const headingVariants = cva(["font-display", "font-bold"], {
  variants: {
    level: {
      1: "text-h1 leading-tight",
      2: "text-body tracking-wider",
    },
    tone: {
      muted: "text-gray-200",
    },
  },
  defaultVariants: { level: 1 },
});

export const bodyVariants = cva("font-display leading-normal", {
  variants: {
    size: { md: "text-body font-light", odd: "text-[13px] font-light" },
    truncate: { end: "overflow-hidden text-ellipsis" },
    strong: { true: "font-normal" },
  },
  defaultVariants: { size: "md" },
});

export const brokenVariants = cva(dynamic);
