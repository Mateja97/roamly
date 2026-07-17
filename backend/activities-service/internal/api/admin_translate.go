package api

import (
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

// toDomainStatus maps the wire enum to the domain Status; UNSPECIFIED (and
// any unrecognized value) maps to "" — "no filter" for ListActivities;
// service.validStatus rejects "" as an unknown status for Create/Update.
func toDomainStatus(s activitiesv1.ActivityStatus) activitiessvc.Status {
	switch s {
	case activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED:
		return activitiessvc.StatusPublished
	case activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT:
		return activitiessvc.StatusDraft
	case activitiesv1.ActivityStatus_ACTIVITY_STATUS_PENDING:
		return activitiessvc.StatusPending
	default:
		return ""
	}
}

func toDomainPhotos(photos []*activitiesv1.Photo) []activitiessvc.Photo {
	out := make([]activitiessvc.Photo, len(photos))
	for i, p := range photos {
		out[i] = activitiessvc.Photo{
			URL: p.GetUrl(), Author: p.GetAuthor(), AuthorLink: p.GetAuthorLink(),
			ThumbURL: p.GetThumbUrl(), Caption: p.GetCaption(),
		}
	}
	return out
}
