export interface GitFailureRequest {
  run_id: string;
  run_number: string;
  repository: string;
  workflow: string;
  branch: string;
  commit: string;
  actor: string;
}
