#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct ChannelState {
	char mode[16];
	char channel[16];
	char supplied_token[32];
	char supplied_receipt[32];
	char supplied_response[32];
} ChannelState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'c' ^ 0x1b, 'h' ^ 0x1b, 'a' ^ 0x1b, 'n' ^ 0x1b, 'n' ^ 0x1b, 'e' ^ 0x1b,
	'l' ^ 0x1b, '-' ^ 0x1b, 't' ^ 0x1b, 'o' ^ 0x1b, 'k' ^ 0x1b, 'e' ^ 0x1b,
	'n' ^ 0x1b, '-' ^ 0x1b, '6' ^ 0x1b, '2' ^ 0x1b,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static uint32_t rol32(uint32_t value, unsigned int shift) {
	shift &= 31U;
	if (shift == 0U) {
		return value;
	}
	return (value << shift) | (value >> (32U - shift));
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x1b);
	}
	output[index] = '\0';
}

static uint32_t hash_token(const char *token) {
	uint32_t hash = 0x811c9dc5U;
	size_t index = 0;
	for (; token[index] != '\0'; index++) {
		hash ^= (unsigned char)token[index];
		hash *= 0x01000193U;
	}
	return hash;
}

static int ensure_dir(const char *path) {
	if (mkdir(path, 0755) == 0 || errno == EEXIST) {
		return 0;
	}
	perror(path);
	return -1;
}

static int append_log_line(const char *runtime_dir, const char *line) {
	char path[PATH_MAX];
	FILE *log_file = NULL;
	snprintf(path, sizeof(path), "%s/channel/channel.log", runtime_dir);
	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{shadow-channel-live}\n");
	fclose(file);
	return 0;
}

static int save_text_file(const char *path, const char *text) {
	FILE *file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", text);
	fclose(file);
	return 0;
}

static int save_challenge(const char *runtime_dir, uint32_t challenge) {
	char path[PATH_MAX];
	char text[32];
	snprintf(text, sizeof(text), "%08x", challenge);
	snprintf(path, sizeof(path), "%s/channel/challenge.hex", runtime_dir);
	return save_text_file(path, text);
}

static int load_challenge(const char *runtime_dir, uint32_t *challenge) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[32];
	snprintf(path, sizeof(path), "%s/channel/challenge.hex", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(line, sizeof(line), file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(line);
	*challenge = (uint32_t)strtoul(line, NULL, 16);
	return 0;
}

static int save_receipt_for_channel(const char *runtime_dir, const char *channel, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	unsigned long salt = strcmp(channel, "primary") == 0 ? 0x6b21UL : 0x4441UL;
	snprintf(receipt, receipt_size, "%08lx", ((unsigned long)getpid() << 1U) ^ salt);
	snprintf(path, sizeof(path), "%s/channel/%s.receipt", runtime_dir, channel);
	return save_text_file(path, receipt);
}

static int load_receipt_for_channel(const char *runtime_dir, const char *channel, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/channel/%s.receipt", runtime_dir, channel);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(receipt);
	return 0;
}

static int delete_challenge(const char *runtime_dir) {
	char path[PATH_MAX];
	snprintf(path, sizeof(path), "%s/channel/challenge.hex", runtime_dir);
	return unlink(path);
}

static int save_branch_state(const char *runtime_dir, const char *state) {
	char path[PATH_MAX];
	snprintf(path, sizeof(path), "%s/channel/state.txt", runtime_dir);
	return save_text_file(path, state);
}

static int load_branch_state(const char *runtime_dir, char *state, size_t state_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/channel/state.txt", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(state, (int)state_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(state);
	return 0;
}

static int load_session(const char *session_dir, ChannelState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(path, sizeof(path), "%s/session.ini", session_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(line, "mode") == 0) {
			snprintf(state->mode, sizeof(state->mode), "%s", value);
		} else if (strcmp(line, "channel") == 0) {
			snprintf(state->channel, sizeof(state->channel), "%s", value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		} else if (strcmp(line, "response") == 0) {
			snprintf(state->supplied_response, sizeof(state->supplied_response), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *session_dir = NULL;
	const char *runtime_dir = "./runtime";
	ChannelState state;
	char secret_token[32];
	char receipt[32];
	char branch_state[32];
	char line[256];
	uint32_t challenge = 0;
	uint32_t supplied = 0;
	uint32_t expected = 0;
	uint32_t channel_mask = 0;
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--session") == 0 && index + 1 < argc) {
			session_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (session_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/channel", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_session(session_dir, &state) != 0) {
		return 1;
	}
	if (state.channel[0] == '\0') {
		snprintf(state.channel, sizeof(state.channel), "%s", "shadow");
	}

	if (strcmp(state.mode, "debug") == 0) {
		if (
			strcmp(state.channel, "shadow") == 0 &&
			load_branch_state(runtime_dir, branch_state, sizeof(branch_state)) == 0 &&
			strcmp(branch_state, "primary-open") == 0
		) {
			save_branch_state(runtime_dir, "poisoned");
			delete_challenge(runtime_dir);
			append_log_line(runtime_dir, "[channel] shadow debug poisoned the current primary challenge");
		}
		challenge = ((uint32_t)getpid() << 3U) ^ 0x005a6211U;
		save_challenge(runtime_dir, challenge);
		save_receipt_for_channel(runtime_dir, state.channel, receipt, sizeof(receipt));
		if (strcmp(state.channel, "primary") == 0) {
			save_branch_state(runtime_dir, "primary-open");
		} else {
			save_branch_state(runtime_dir, "shadow-open");
		}
		append_log_line(runtime_dir, "[channel] phase=debug");
		snprintf(line, sizeof(line), "[channel] branch=%s", state.channel);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[channel] challenge=%08x", challenge);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[channel] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[channel] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
		printf("channel disclosure complete\n");
		return 0;
	}

	if (strcmp(state.mode, "commit") == 0) {
		if (load_branch_state(runtime_dir, branch_state, sizeof(branch_state)) != 0) {
			append_log_line(runtime_dir, "[channel] commit rejected: missing branch state");
			printf("channel commit failed\n");
			return 1;
		}
		if (strcmp(branch_state, "poisoned") == 0) {
			append_log_line(runtime_dir, "[channel] commit rejected: current challenge was poisoned");
			printf("channel commit failed\n");
			return 1;
		}
		if (load_challenge(runtime_dir, &challenge) != 0) {
			append_log_line(runtime_dir, "[channel] commit rejected: missing challenge");
			printf("channel commit failed\n");
			return 1;
		}
		if (load_receipt_for_channel(runtime_dir, state.channel, receipt, sizeof(receipt)) != 0) {
			append_log_line(runtime_dir, "[channel] commit rejected: missing branch receipt");
			printf("channel commit failed\n");
			return 1;
		}
		channel_mask = strcmp(state.channel, "primary") == 0 ? 0x91e10da5U : 0x33704111U;
		expected = rol32(hash_token(secret_token) ^ challenge ^ channel_mask, 5U) ^ 0x62aa7713U;
		supplied = (uint32_t)strtoul(state.supplied_response, NULL, 16);
		snprintf(line, sizeof(line), "[channel] branch=%s expected=%08x supplied=%08x", state.channel, expected, supplied);
		append_log_line(runtime_dir, line);
		if (
			strcmp(state.supplied_token, secret_token) == 0 &&
			strcmp(state.supplied_receipt, receipt) == 0 &&
			supplied == expected
		) {
			if (strcmp(state.channel, "primary") == 0) {
				save_branch_state(runtime_dir, "consumed");
				write_flag(runtime_dir);
				append_log_line(runtime_dir, "[root] root_channel created proof artifact");
				printf("channel proof completed successfully\n");
				return 0;
			}
			save_branch_state(runtime_dir, "poisoned");
			delete_challenge(runtime_dir);
			append_log_line(runtime_dir, "[channel] shadow branch accepted and invalidated the primary challenge");
			printf("shadow branch completed without privileged proof\n");
			return 0;
		}
		append_log_line(runtime_dir, "[channel] commit rejected: token, receipt, or response mismatch");
		printf("channel commit failed\n");
		return 0;
	}

	append_log_line(runtime_dir, "[channel] session completed without privileged action");
	printf("session completed without privileged action\n");
	return 0;
}
