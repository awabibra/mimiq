export function Logo({ className }: { className?: string }) {
  const baseClasses = "inline-flex items-center font-extrabold tracking-tighter lowercase";
  const combinedClasses = className ? `${baseClasses} ${className}` : baseClasses;

  return (
    <span className={combinedClasses}>
      mimi
      <svg 
        viewBox="0 0 26 34" 
        className="h-[1.15em] w-auto ml-[0.02em] translate-y-[0.12em] text-[#d7ff3f]" 
        fill="currentColor" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <path fillRule="evenodd" clipRule="evenodd" d="M10 4C5.02944 4 1 8.02944 1 13C1 17.9706 5.02944 22 10 22C14.9706 22 19 17.9706 19 13C19 8.02944 14.9706 4 10 4ZM10 8.5C7.51472 8.5 5.5 10.5147 5.5 13C5.5 15.4853 7.51472 17.5 10 17.5C12.4853 17.5 14.5 15.4853 14.5 13C14.5 10.5147 12.4853 8.5 10 8.5Z" />
        <rect x="14.5" y="4" width="4.5" height="30" />
        <rect x="19" y="23" width="6" height="4.5" />
        <rect x="19" y="29.5" width="3.5" height="4.5" />
      </svg>
    </span>
  );
}
