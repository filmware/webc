import AcronymIcon from '@/components/AcronymIcon';

export type Props = {
  name: string;
};

function Avatar({ name }: Props) {
  return <AcronymIcon round value={name} />;
}

export default Avatar;
