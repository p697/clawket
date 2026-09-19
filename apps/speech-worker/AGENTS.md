# Speech service

Independent Alibaba Cloud transcription service; never add speech secrets or traffic to Relay/Registry. Audio and transcripts stay in memory and must never be logged or persisted. Only bounded anonymous admission counters may persist. Verify signed device requests, reject replays, and reserve the full recording allowance before contacting the provider. Provider errors expose only stable error codes. Keep provider model/endpoint server-controlled and credentials in Worker secrets. Future paid admission belongs at this server boundary; a client Pro flag is not authorization.
