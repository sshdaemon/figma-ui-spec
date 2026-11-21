export interface ButtonProps {
  label: string;
}

const Button = ({ label }: ButtonProps) => <button type="button">{label}</button>;

export default Button;

export const IconButton = () => <button type="button" />;

function Pill() {
  return <span />;
}

export { Pill };

export const helper = 1;
