interface Props {
  title: string;
}

export function ComingSoon({ title }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 text-5xl">🚧</div>
      <h2 className="text-xl font-semibold text-gray-700">{title}</h2>
      <p className="mt-2 text-gray-400">יעודכן בהמשך</p>
    </div>
  );
}
