// Shared brand heading component for consistent typography across DartBoard
export function BrandHeading({ children, as: Component = "h1", className = "" }: { 
  children: React.ReactNode; 
  as?: keyof JSX.IntrinsicElements;
  className?: string;
}) {
  const baseClasses = "text-[2.375rem] leading-tight font-bold bg-gradient-to-r from-blue-400 from-5% via-blue-500 to-blue-300 bg-clip-text text-transparent";
  const combinedClasses = `${baseClasses} ${className}`.trim();
  
  return <Component className={combinedClasses}>{children}</Component>;
}
