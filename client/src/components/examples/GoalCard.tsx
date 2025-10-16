import { GoalCard } from "../GoalCard";

export default function GoalCardExample() {
  return (
    <div className="p-4">
      <GoalCard
        title="Emergency Fund"
        current={8500}
        target={10000}
        deadline="Dec 31, 2025"
        status="on-track"
        testId="goal-example"
      />
    </div>
  );
}
