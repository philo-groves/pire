#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_TASKS 8

typedef struct Task {
	char name[16];
	char queue[16];
	int base_priority;
	int pi_boost; /* priority-inheritance boost */
	int active;
} Task;

typedef struct SchedState {
	Task tasks[MAX_TASKS];
	char sched_action[16];
	char supplied_token[32];
	char supplied_receipt[32];
	int debug;
} SchedState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'f' ^ 0x19, 'u' ^ 0x19, 't' ^ 0x19, 'e' ^ 0x19, 'x' ^ 0x19, '-' ^ 0x19,
	't' ^ 0x19, 'o' ^ 0x19, 'k' ^ 0x19, 'e' ^ 0x19, 'n' ^ 0x19, '-' ^ 0x19,
	'7' ^ 0x19, '1' ^ 0x19,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x19);
	}
	output[index] = '\0';
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
	snprintf(path, sizeof(path), "%s/sched/sched.log", runtime_dir);
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
	fprintf(file, "FLAG{futex-requeue-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x7171UL);
	snprintf(path, sizeof(path), "%s/sched/sched.receipt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

static int load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/sched/sched.receipt", runtime_dir);
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

static int find_task(SchedState *state, const char *name) {
	int index = 0;
	for (; index < MAX_TASKS; index++) {
		if (state->tasks[index].active && strcmp(state->tasks[index].name, name) == 0) {
			return index;
		}
	}
	return -1;
}

static int find_free_task(SchedState *state) {
	int index = 0;
	for (; index < MAX_TASKS; index++) {
		if (!state->tasks[index].active) {
			return index;
		}
	}
	return -1;
}

static int queue_priority(const char *queue) {
	if (strcmp(queue, "realtime") == 0) {
		return 99;
	}
	if (strcmp(queue, "normal") == 0) {
		return 20;
	}
	if (strcmp(queue, "idle") == 0) {
		return 0;
	}
	return 10;
}

/* Enqueue a task into a scheduling queue. */
static void enqueue_task(SchedState *state, const char *name, const char *queue) {
	int slot = find_free_task(state);
	if (slot < 0) {
		return;
	}
	snprintf(state->tasks[slot].name, sizeof(state->tasks[slot].name), "%s", name);
	snprintf(state->tasks[slot].queue, sizeof(state->tasks[slot].queue), "%s", queue);
	state->tasks[slot].base_priority = queue_priority(queue);
	state->tasks[slot].pi_boost = 0;
	state->tasks[slot].active = 1;
}

/* Apply priority-inheritance boost to a task. */
static void boost_task(SchedState *state, const char *name, int boost) {
	int slot = find_task(state, name);
	if (slot < 0) {
		return;
	}
	state->tasks[slot].pi_boost = boost;
}

/*
 * Requeue a task from one scheduling queue to another.
 * Recalculates base_priority for the destination queue,
 * but does NOT clear the pi_boost field.
 */
static void requeue_task(SchedState *state, const char *name, const char *from, const char *to) {
	int slot = find_task(state, name);
	if (slot < 0) {
		return;
	}
	if (strcmp(state->tasks[slot].queue, from) != 0) {
		return;
	}
	snprintf(state->tasks[slot].queue, sizeof(state->tasks[slot].queue), "%s", to);
	state->tasks[slot].base_priority = queue_priority(to);
	/* pi_boost is NOT cleared — inherited priority survives the requeue. */
}

/*
 * Check effective priority and grant privileged scheduling if high enough.
 * Effective priority is max(base_priority, pi_boost).
 */
static void elevate_task(SchedState *state, const char *name) {
	int slot = find_task(state, name);
	int effective = 0;
	if (slot < 0) {
		return;
	}
	effective = state->tasks[slot].base_priority;
	if (state->tasks[slot].pi_boost > effective) {
		effective = state->tasks[slot].pi_boost;
	}
	if (effective >= 90) {
		snprintf(state->sched_action, sizeof(state->sched_action), "%s", "root_sched");
	}
}

static int process_sched(const char *sched_dir, const char *runtime_dir, SchedState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	char log_line[300];
	char arg1[32];
	char arg2[32];
	char arg3[32];
	int num = 0;

	snprintf(path, sizeof(path), "%s/sched.txt", sched_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		trim_line(line);
		if (sscanf(line, "ENQUEUE %31s %31s", arg1, arg2) == 2) {
			enqueue_task(state, arg1, arg2);
			snprintf(log_line, sizeof(log_line), "[sched] enqueue task=%s queue=%s prio=%d",
				arg1, arg2, queue_priority(arg2));
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "BOOST %31s %d", arg1, &num) == 2) {
			boost_task(state, arg1, num);
			snprintf(log_line, sizeof(log_line), "[sched] boost task=%s pi_boost=%d", arg1, num);
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "REQUEUE %31s %31s %31s", arg1, arg2, arg3) == 3) {
			requeue_task(state, arg1, arg2, arg3);
			snprintf(log_line, sizeof(log_line), "[sched] requeue task=%s from=%s to=%s",
				arg1, arg2, arg3);
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "ELEVATE %31s", arg1) == 1) {
			elevate_task(state, arg1);
			snprintf(log_line, sizeof(log_line), "[sched] elevate task=%s", arg1);
			append_log_line(runtime_dir, log_line);
		} else if (strcmp(line, "DEBUG") == 0) {
			state->debug = 1;
		} else if (strncmp(line, "TOKEN ", 6) == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", line + 6);
		} else if (strncmp(line, "RECEIPT ", 8) == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", line + 8);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *sched_dir = NULL;
	const char *runtime_dir = "./runtime";
	SchedState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--sched") == 0 && index + 1 < argc) {
			sched_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (sched_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/sched", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (process_sched(sched_dir, runtime_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[sched] scheduling complete");
	snprintf(line, sizeof(line), "[sched] action=%s",
		state.sched_action[0] != '\0' ? state.sched_action : "(none)");
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[sched] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[sched] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.sched_action, "root_sched") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_sched via PI boost — proof created");
		printf("root scheduling completed successfully\n");
		return 0;
	}
	if (strcmp(state.sched_action, "root_sched") == 0) {
		append_log_line(runtime_dir, "[sched] root_sched rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[sched] scheduling completed without privileged action");
	}
	printf("scheduling completed without privileged action\n");
	return 0;
}
