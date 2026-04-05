{{/*
Expand the name of the chart.
*/}}
{{- define "ccc-manager.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ccc-manager.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ccc-manager.labels" -}}
helm.sh/chart: {{ include "ccc-manager.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "ccc-manager.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: ccc
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ccc-manager.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ccc-manager.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Image tag (defaults to Chart.appVersion)
*/}}
{{- define "ccc-manager.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion }}
{{- end }}
