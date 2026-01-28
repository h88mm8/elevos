interface ElevOSLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const sizeClasses = {
  sm: "h-5 w-5 text-xs",
  md: "h-6 w-6 text-sm",
  lg: "h-8 w-8 text-base",
};

const textSizeClasses = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-2xl",
};

export function ElevOSLogo({ size = "md", showText = true }: ElevOSLogoProps) {
  return (
    <div className="flex items-center gap-2">
      <div 
        className={`${sizeClasses[size]} bg-foreground text-background rounded-md flex items-center justify-center font-bold`}
      >
        E
      </div>
      {showText && (
        <span className={`font-bold ${textSizeClasses[size]}`}>ELEV OS</span>
      )}
    </div>
  );
}
