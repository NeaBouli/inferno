interface StatusBadgeProps {
  status: string;
}

const styles: Record<string, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  APPROVED: 'bg-ifr-green/10 text-ifr-green border-ifr-green/30',
  REJECTED: 'bg-ifr-red/10 text-ifr-red border-ifr-red/30',
  EXPIRED: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  REDEEMED: 'bg-ifr-green/10 text-ifr-green border-ifr-green/30',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold border ${
        styles[status] || styles.PENDING
      }`}
    >
      {status}
    </span>
  );
}
