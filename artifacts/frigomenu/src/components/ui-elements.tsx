import React, { forwardRef } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive', size?: 'sm' | 'md' | 'lg' | 'icon' }>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const variants = {
      primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
      secondary: "bg-accent text-accent-foreground shadow-sm hover:bg-accent/90",
      outline: "border border-border/60 bg-transparent text-foreground hover:border-border hover:bg-muted/30",
      ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
      destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
    };
    
    const sizes = {
      sm: "px-3 py-1.5 text-sm rounded-xl",
      md: "px-5 py-2.5 rounded-2xl font-medium",
      lg: "px-8 py-3.5 rounded-3xl font-semibold text-lg",
      icon: "p-2.5 rounded-xl",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex w-full rounded-2xl border border-border/60 bg-background/50 px-4 py-3 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export const Label = forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground/80", className)}
      {...props}
    />
  )
);
Label.displayName = "Label";

export const Badge = ({ children, className, variant = 'default' }: { children: React.ReactNode, className?: string, variant?: 'default' | 'success' | 'warning' | 'outline' }) => {
  const variants = {
    default: "bg-primary/10 text-primary border-primary/10",
    success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/10",
    warning: "bg-amber-500/10 text-amber-600 border-amber-500/10",
    outline: "border-border/60 text-muted-foreground"
  };
  
  return (
    <span className={cn("inline-flex items-center rounded-2xl border px-3 py-1 text-xs font-semibold transition-colors", variants[variant], className)}>
      {children}
    </span>
  );
};

export const Card = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("bg-card rounded-3xl border border-border/40 shadow-sm overflow-hidden", className)} {...props}>
    {children}
  </div>
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex w-full rounded-2xl border border-border/60 bg-background/50 px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 appearance-none",
          className
        )}
        {...props}
      />
    );
  }
);
Select.displayName = "Select";
