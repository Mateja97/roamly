package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"

	"activities-service/internal/photo"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestUpdateActivity_OnlySetFieldsReachTheService(t *testing.T) {
	fake := &fakeQueryService{updateOut: activitiessvc.Activity{ID: "1", Title: "Updated"}}
	client := dialServer(t, fake)

	newTitle := "New Title"
	newStatus := activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED
	resp, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Title: &newTitle, Status: &newStatus,
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if resp.GetId() != "1" {
		t.Errorf("unexpected activity: %+v", resp)
	}
	if fake.gotUpdateID != "1" {
		t.Errorf("service received id = %q, want 1", fake.gotUpdateID)
	}
	patch := fake.gotUpdatePtch
	if patch.Title == nil || *patch.Title != "New Title" {
		t.Errorf("patch.Title = %v, want New Title", patch.Title)
	}
	if patch.Status == nil || *patch.Status != activitiessvc.StatusPublished {
		t.Errorf("patch.Status = %v, want published", patch.Status)
	}
	if patch.Description != nil || patch.Category != nil || patch.City != nil || patch.Address != nil || patch.Details != nil || patch.Photos != nil {
		t.Errorf("patch = %+v, want every omitted field nil (untouched)", patch)
	}
}

func TestUpdateActivity_PhotosPresenceUnwrapsThePhotoListWrapper(t *testing.T) {
	fake := &fakeQueryService{}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1",
		Photos: &activitiesv1.PhotoList{Photos: []*activitiesv1.Photo{
			{Url: "https://example.com/x.jpg", ThumbUrl: "https://example.com/x_t.jpg", Caption: "Sunset"},
		}},
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if fake.gotUpdatePtch.Photos == nil || len(*fake.gotUpdatePtch.Photos) != 1 || (*fake.gotUpdatePtch.Photos)[0].URL != "https://example.com/x.jpg" {
		t.Errorf("patch.Photos = %v, want the one submitted photo", fake.gotUpdatePtch.Photos)
	}
	if (*fake.gotUpdatePtch.Photos)[0].ThumbURL != "https://example.com/x_t.jpg" || (*fake.gotUpdatePtch.Photos)[0].Caption != "Sunset" {
		t.Errorf("patch.Photos = %+v, want thumb_url/caption translated", (*fake.gotUpdatePtch.Photos)[0])
	}
}

func TestUpdateActivity_EmptyPhotoListIsPresentButEmpty(t *testing.T) {
	fake := &fakeQueryService{}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Photos: &activitiesv1.PhotoList{},
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if fake.gotUpdatePtch.Photos == nil {
		t.Fatal("patch.Photos = nil, want non-nil (present, even though empty) since PhotoList was set on the wire")
	}
	if len(*fake.gotUpdatePtch.Photos) != 0 {
		t.Errorf("patch.Photos = %v, want empty", *fake.gotUpdatePtch.Photos)
	}
}

func TestUpdateActivity_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeQueryService{updateErr: sharederrors.ErrNotFound}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{Id: "missing"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("status code = %v, want NotFound", status.Code(err))
	}
}

func TestUpdateActivity_InvalidInputMapsTo400(t *testing.T) {
	fake := &fakeQueryService{updateErr: fmt.Errorf("updating: %w", sharederrors.ErrInvalidInput)}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{Id: "1"})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestUpdateActivity_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{updateErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{Id: "1"})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}

// --- T2: delete-on-remove ---
//
// These use a real photo.Store rooted at t.TempDir() instead of
// fakeQueryService's call-tracking Unlink, because the guarantee under test
// is "the file is/isn't on disk afterward", not "Unlink was called with the
// right string".

func mustWriteFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("creating %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
}

func fileExists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	switch {
	case err == nil:
		return true
	case os.IsNotExist(err):
		return false
	default:
		t.Fatalf("stat %s: %v", path, err)
		return false
	}
}

func TestUpdateActivity_RemovedPhotoUnlinksBothFiles(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "act1", "old.jpg")
	thumbPath := filepath.Join(root, "act1", "old_t.jpg")
	mustWriteFile(t, mainPath)
	mustWriteFile(t, thumbPath)

	fake := &fakeQueryService{
		getOut: activitiessvc.Activity{Photos: []activitiessvc.Photo{
			{URL: "/photos/act1/old.jpg", ThumbURL: "/photos/act1/old_t.jpg"},
		}},
		updateOut: activitiessvc.Activity{ID: "1"},
	}
	client := dialServerWithPhotos(t, fake, photo.NewStore(root))

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Photos: &activitiesv1.PhotoList{},
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if fileExists(t, mainPath) {
		t.Error("main photo file still exists, want unlinked")
	}
	if fileExists(t, thumbPath) {
		t.Error("thumbnail file still exists, want unlinked")
	}
}

func TestUpdateActivity_GoogleURLLeftUntouched(t *testing.T) {
	root := t.TempDir()
	decoy := filepath.Join(root, "act1", "keep.jpg")
	mustWriteFile(t, decoy)

	fake := &fakeQueryService{
		getOut: activitiessvc.Activity{Photos: []activitiessvc.Photo{
			{URL: "https://maps.googleapis.com/photo.jpg"},
		}},
		updateOut: activitiessvc.Activity{ID: "1"},
	}
	client := dialServerWithPhotos(t, fake, photo.NewStore(root))

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Photos: &activitiesv1.PhotoList{}, // the Google photo is removed from the array
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if !fileExists(t, decoy) {
		t.Error("unrelated file under root was deleted, want a Google-sourced URL to never touch our volume")
	}
}

func TestUpdateActivity_RemovedThenReAddedPhotoSurvives(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "act1", "keep.jpg")
	mustWriteFile(t, mainPath)

	fake := &fakeQueryService{
		getOut: activitiessvc.Activity{Photos: []activitiessvc.Photo{
			{URL: "/photos/act1/keep.jpg"},
		}},
		updateOut: activitiessvc.Activity{ID: "1"},
	}
	client := dialServerWithPhotos(t, fake, photo.NewStore(root))

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Photos: &activitiesv1.PhotoList{Photos: []*activitiesv1.Photo{
			{Url: "/photos/act1/keep.jpg"}, // same url, still present in the new array
		}},
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if !fileExists(t, mainPath) {
		t.Error("photo still present in the new array was deleted, want it to survive")
	}
}

func TestUpdateActivity_FailedUpdateDeletesNothing(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "act1", "keep.jpg")
	mustWriteFile(t, mainPath)

	fake := &fakeQueryService{
		getOut: activitiessvc.Activity{Photos: []activitiessvc.Photo{
			{URL: "/photos/act1/keep.jpg"},
		}},
		updateErr: errors.New("db exploded"),
	}
	client := dialServerWithPhotos(t, fake, photo.NewStore(root))

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Photos: &activitiesv1.PhotoList{}, // would remove the photo, if the write had succeeded
	})
	if status.Code(err) != codes.Internal {
		t.Fatalf("status code = %v, want Internal", status.Code(err))
	}
	if !fileExists(t, mainPath) {
		t.Error("photo was deleted despite a failed DB write, want a failed save to never destroy a live photo")
	}
}

func TestUpdateActivity_TraversalURLSkipped(t *testing.T) {
	tempDir := t.TempDir()
	root := filepath.Join(tempDir, "photos")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("creating root: %v", err)
	}
	// "/photos/../escape.jpg" resolves to tempDir/escape.jpg, one level
	// above root — outside the volume the guard must keep it inside.
	decoy := filepath.Join(tempDir, "escape.jpg")
	mustWriteFile(t, decoy)

	fake := &fakeQueryService{
		getOut: activitiessvc.Activity{Photos: []activitiessvc.Photo{
			{URL: "/photos/../escape.jpg"},
		}},
		updateOut: activitiessvc.Activity{ID: "1"},
	}
	client := dialServerWithPhotos(t, fake, photo.NewStore(root))

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Photos: &activitiesv1.PhotoList{},
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v, want nil (a guard failure never fails the request)", err)
	}
	if !fileExists(t, decoy) {
		t.Error("file outside root was deleted, want the traversal guard to skip it")
	}
}

func TestUpdateActivity_PatchNotTouchingPhotosDeletesNothing(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "act1", "keep.jpg")
	mustWriteFile(t, mainPath)

	fake := &fakeQueryService{
		getOut: activitiessvc.Activity{Photos: []activitiessvc.Photo{
			{URL: "/photos/act1/keep.jpg"},
		}},
		updateOut: activitiessvc.Activity{ID: "1", Title: "Renamed"},
	}
	client := dialServerWithPhotos(t, fake, photo.NewStore(root))

	newTitle := "Renamed"
	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Title: &newTitle, // Photos field entirely absent
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if fake.gotGetID != "" {
		t.Errorf("GetByID was called (id=%q), want no old-photos snapshot when the patch doesn't touch Photos", fake.gotGetID)
	}
	if !fileExists(t, mainPath) {
		t.Error("photo was deleted by a patch that never touched Photos")
	}
}
